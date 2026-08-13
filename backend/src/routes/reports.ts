import { Router } from 'express';
import { IdeaStatus, Role } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { filteredReportQuerySchema } from '../utils/validation';

const router = Router();

// Sanitize a string for safe CSV output (prevent formula injection)
function sanitizeCsvField(value: string): string {
  let escaped = value.replace(/"/g, '""');
  // Prevent CSV injection: prefix formulaic characters with a single quote
  if (/^[=+\-@\t\r]/.test(escaped)) {
    escaped = "'" + escaped;
  }
  return `"${escaped}"`;
}

// Get dashboard summary statistics
router.get('/summary', requireAuth, async (_req, res) => {
  try {
    // Idea visibility is org-wide for every authenticated role: the counts are
    // not scoped to the caller (same read-only visibility as GET /api/ideas).
    const [submitted, approved, inProgress, done, rejected, allIdeas] = await Promise.all([
      prisma.idea.count({ where: { status: IdeaStatus.SUBMITTED } }),
      prisma.idea.count({ where: { status: IdeaStatus.APPROVED } }),
      prisma.idea.count({ where: { status: IdeaStatus.IN_PROGRESS } }),
      prisma.idea.count({ where: { status: IdeaStatus.DONE } }),
      prisma.idea.count({ where: { status: IdeaStatus.REJECTED } }),
      prisma.idea.findMany({
        where: {
          OR: [
            { status: IdeaStatus.DONE },
            { status: IdeaStatus.IN_PROGRESS },
          ],
        },
        select: {
          submittedAt: true,
          approvedAt: true,
          startedAt: true,
          completedAt: true,
          status: true,
        },
      }),
    ]);

    // Calculate average times
    let avgSubmittedToApproved = 0;
    let avgApprovedToDone = 0;
    let countForAvgApproval = 0;
    let countForAvgCompletion = 0;

    allIdeas.forEach((idea) => {
      if (idea.submittedAt && idea.approvedAt) {
        avgSubmittedToApproved +=
          idea.approvedAt.getTime() - idea.submittedAt.getTime();
        countForAvgApproval++;
      }
      if (idea.approvedAt && idea.completedAt) {
        avgApprovedToDone +=
          idea.completedAt.getTime() - idea.approvedAt.getTime();
        countForAvgCompletion++;
      }
    });

    if (countForAvgApproval > 0) {
      avgSubmittedToApproved = avgSubmittedToApproved / countForAvgApproval / (1000 * 60 * 60 * 24); // Convert to days
    }
    if (countForAvgCompletion > 0) {
      avgApprovedToDone = avgApprovedToDone / countForAvgCompletion / (1000 * 60 * 60 * 24); // Convert to days
    }

    res.json({
      counts: {
        submitted,
        approved,
        inProgress,
        done,
        rejected,
        total: submitted + approved + inProgress + done + rejected,
      },
      averageTimes: {
        submittedToApprovedDays: Math.round(avgSubmittedToApproved * 10) / 10,
        approvedToDoneDays: Math.round(avgApprovedToDone * 10) / 10,
      },
    });
  } catch (error) {
    console.error('Error fetching summary:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get idea counts grouped by department (zero-filled: every department is listed
// even with a count of 0, sorted by department order).
router.get('/by-department', requireAuth, async (_req, res) => {
  try {
    // Org-wide for every authenticated role (same visibility as /summary).
    const [departments, grouped] = await Promise.all([
      prisma.department.findMany({
        orderBy: [{ order: 'asc' }, { name: 'asc' }],
      }),
      prisma.idea.groupBy({
        by: ['departmentId'],
        _count: { id: true },
      }),
    ]);

    const countByDepartment = new Map<string, number>();
    grouped.forEach((g) => {
      if (g.departmentId) {
        countByDepartment.set(g.departmentId, g._count.id);
      }
    });

    const result = departments.map((d) => ({
      departmentId: d.id,
      name: d.name,
      count: countByDepartment.get(d.id) ?? 0,
    }));

    res.json(result);
  } catch (error) {
    console.error('Error fetching by-department report:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get idea counts grouped by the RAW Jira status name (dashboard breakdown).
//
// Only DISPATCHED ideas are counted, and only the raw Jira status is exposed — the
// canonical IdeaStatus breakdown lives in /summary. The two presence filters use
// Prisma Mongo's `isSet` operator rather than a bare `not: null`: an idea document
// that predates the Jira fields has no such field at all, and a Prisma+Mongo
// where-clause does NOT match a missing scalar (the same limitation the boot
// backfill exists for), so `not: null` alone would silently drop rows on some
// documents and match nothing on others.
//
// Scoping mirrors /summary and /by-department exactly: a USER only ever sees their
// own ideas, every other role sees all of them.
router.get('/jira-statuses', requireAuth, async (req, res) => {
  try {
    const userFilter = req.session.role === Role.USER ? { submitterId: req.session.userId } : {};

    const grouped = await prisma.idea.groupBy({
      by: ['jiraStatus'],
      where: {
        jiraIssueKey: { isSet: true },
        jiraStatus: { isSet: true, not: null },
        ...userFilter,
      },
      _count: { id: true },
    });

    // Biggest bucket first, ties broken by name for a deterministic response. The
    // status strings were sanitized at the Jira ingest boundary before they were
    // stored (utils/jira.ts), so nothing raw from the remote system is echoed here.
    const result = grouped
      .filter((g): g is typeof g & { jiraStatus: string } => g.jiraStatus !== null)
      .map((g) => ({ status: g.jiraStatus, count: g._count.id }))
      .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status));

    res.json(result);
  } catch (error) {
    console.error('Error fetching jira status report:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get monthly trend data
router.get('/monthly-trend', requireAuth, async (_req, res) => {
  try {
    // Org-wide for every authenticated role (same visibility as /summary).
    const ideas = await prisma.idea.findMany({
      where: {
        status: IdeaStatus.DONE,
        completedAt: {
          not: null,
        },
      },
      select: {
        completedAt: true,
      },
    });

    // Group by month
    const monthlyData: { [key: string]: number } = {};
    ideas.forEach((idea) => {
      if (idea.completedAt) {
        const monthKey = `${idea.completedAt.getFullYear()}-${String(
          idea.completedAt.getMonth() + 1
        ).padStart(2, '0')}`;
        monthlyData[monthKey] = (monthlyData[monthKey] || 0) + 1;
      }
    });

    // Convert to array and sort
    const trend = Object.entries(monthlyData)
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => a.month.localeCompare(b.month));

    res.json(trend);
  } catch (error) {
    console.error('Error fetching monthly trend:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get top contributors (Power User or Admin only)
router.get('/top-contributors', requireRole(Role.POWER_USER, Role.ADMIN), async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 10, 1), 50);

    const contributors = await prisma.idea.groupBy({
      by: ['assigneeId'],
      where: {
        status: IdeaStatus.DONE,
        assigneeId: { not: null },
      },
      _count: {
        id: true,
      },
      orderBy: {
        _count: {
          id: 'desc',
        },
      },
      take: limit,
    });

    // Get user details
    const userIds = contributors.map((c) => c.assigneeId).filter((id): id is string => id !== null);
    const users = await prisma.user.findMany({
      where: {
        id: { in: userIds },
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    const result = contributors.map((c) => {
      const user = users.find((u) => u.id === c.assigneeId);
      return {
        userId: c.assigneeId,
        userName: user?.name || 'Unknown',
        userEmail: user?.email || '',
        completedIdeas: c._count.id,
      };
    });

    res.json(result);
  } catch (error) {
    console.error('Error fetching top contributors:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get filtered report data with CSV export capability
router.get('/filtered', requireAuth, async (req, res) => {
  try {
    const parsed = filteredReportQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const data = parsed.data;
    const page = data.page as number;
    const limit = data.limit as number;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (data.status) {
      where.status = data.status;
    }
    // Idea reads are org-wide for every role, so a client-sent submitterId is
    // an ordinary filter here (no server-side self-scoping for USER anymore).
    if (data.submitterId) {
      where.submitterId = data.submitterId;
    }
    if (data.assigneeId) {
      where.assigneeId = data.assigneeId;
    }
    if (data.departmentId) {
      where.departmentId = data.departmentId;
    }
    if (data.tags) {
      where.tags = {
        hasSome: Array.isArray(data.tags) ? data.tags : [data.tags],
      };
    }
    if (data.startDate || data.endDate) {
      const submittedAt: { gte?: Date; lt?: Date } = {};
      if (data.startDate) {
        submittedAt.gte = new Date(data.startDate as string);
      }
      if (data.endDate) {
        // `endDate` names a whole day, not the instant of its UTC midnight.
        // `lte: <endDate>` silently dropped everything submitted ON that day, so
        // compare against the NEXT UTC midnight with `lt` to keep the end day in.
        const end = new Date(data.endDate as string);
        end.setUTCDate(end.getUTCDate() + 1);
        submittedAt.lt = end;
      }
      where.submittedAt = submittedAt;
    }

    const [ideas, total] = await Promise.all([
      prisma.idea.findMany({
        where,
        include: {
          submitter: {
            select: { id: true, name: true, email: true },
          },
          approver: {
            select: { id: true, name: true, email: true },
          },
          assignee: {
            select: { id: true, name: true, email: true },
          },
          department: {
            select: { id: true, name: true },
          },
        },
        orderBy: { submittedAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.idea.count({ where }),
    ]);

    // If CSV format requested
    if (data.format === 'csv') {
      const csvRows = [
        [
          'ID',
          'Title',
          'Status',
          'Effort',
          'Submitter',
          'Approver',
          'Assignee',
          'Submitted At',
          'Approved At',
          'Started At',
          'Completed At',
          'Duration (days)',
          'Tags',
          'Department',
          // Mirrored Jira fields. EVERY one of these is a REMOTE string, so every
          // one of them goes through sanitizeCsvField below — see the row block.
          'Jira Key',
          'Jira Status',
          'Jira Assignee',
          'Jira Resolution',
        ].join(','),
      ];

      ideas.forEach((idea) => {
        const duration =
          idea.completedAt && idea.submittedAt
            ? Math.round(
                (idea.completedAt.getTime() - idea.submittedAt.getTime()) / (1000 * 60 * 60 * 24)
              )
            : '';

        csvRows.push(
          [
            idea.id,
            sanitizeCsvField(idea.title),
            idea.status,
            idea.effort,
            sanitizeCsvField(idea.submitter.name),
            idea.approver ? sanitizeCsvField(idea.approver.name) : '',
            idea.assignee ? sanitizeCsvField(idea.assignee.name) : '',
            idea.submittedAt.toISOString(),
            idea.approvedAt ? idea.approvedAt.toISOString() : '',
            idea.startedAt ? idea.startedAt.toISOString() : '',
            idea.completedAt ? idea.completedAt.toISOString() : '',
            duration,
            sanitizeCsvField(idea.tags.join(', ')),
            idea.department ? sanitizeCsvField(idea.department.name) : '',
            // The four Jira cells. These are the only values in this file that come
            // from a THIRD-PARTY system (an issue key, a workflow status name, an
            // assignee display name, a resolution name), so each one MUST go through
            // sanitizeCsvField — it both quotes/escapes the value and defuses CSV
            // formula injection (a status literally named "=cmd|…" would otherwise
            // execute when the export is opened in a spreadsheet). A null field
            // (never dispatched, unassigned, unresolved) renders as an empty cell,
            // exactly like the optional cells above.
            idea.jiraIssueKey ? sanitizeCsvField(idea.jiraIssueKey) : '',
            idea.jiraStatus ? sanitizeCsvField(idea.jiraStatus) : '',
            idea.jiraAssignee ? sanitizeCsvField(idea.jiraAssignee) : '',
            idea.jiraResolution ? sanitizeCsvField(idea.jiraResolution) : '',
          ].join(',')
        );
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=ideas-report.csv');
      res.send(csvRows.join('\n'));
    } else {
      res.json({
        data: ideas,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    }
  } catch (error) {
    console.error('Error fetching filtered report:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
