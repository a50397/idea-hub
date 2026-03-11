import { Router } from 'express';
import { IdeaStatus } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { filteredReportQuerySchema } from '../utils/validation';

const router = Router();

// Get dashboard summary statistics
router.get('/summary', requireAuth, async (req, res) => {
  try {
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

// Get monthly trend data
router.get('/monthly-trend', requireAuth, async (req, res) => {
  try {
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

// Get top contributors
router.get('/top-contributors', requireAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;

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
    if (data.submitterId) {
      where.submitterId = data.submitterId;
    }
    if (data.assigneeId) {
      where.assigneeId = data.assigneeId;
    }
    if (data.tags) {
      where.tags = {
        hasSome: Array.isArray(data.tags) ? data.tags : [data.tags],
      };
    }
    if (data.startDate || data.endDate) {
      const submittedAt: { gte?: Date; lte?: Date } = {};
      if (data.startDate) {
        submittedAt.gte = new Date(data.startDate as string);
      }
      if (data.endDate) {
        submittedAt.lte = new Date(data.endDate as string);
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
            `"${idea.title.replace(/"/g, '""')}"`,
            idea.status,
            idea.effort,
            `"${idea.submitter.name}"`,
            idea.approver ? `"${idea.approver.name}"` : '',
            idea.assignee ? `"${idea.assignee.name}"` : '',
            idea.submittedAt.toISOString(),
            idea.approvedAt ? idea.approvedAt.toISOString() : '',
            idea.startedAt ? idea.startedAt.toISOString() : '',
            idea.completedAt ? idea.completedAt.toISOString() : '',
            duration,
            `"${idea.tags.join(', ')}"`,
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
