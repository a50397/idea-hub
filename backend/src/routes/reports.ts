import { Router } from 'express';
import { PrismaClient, IdeaStatus } from '@prisma/client';
import { requireAuth } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

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
    const allIdeas = await prisma.idea.findMany({
      select: {
        status: true,
        submittedAt: true,
        approvedAt: true,
        rejectedAt: true,
        completedAt: true,
      },
    });

    // Group by month for each status
    const submittedData: { [key: string]: number } = {};
    const approvedData: { [key: string]: number } = {};
    const rejectedData: { [key: string]: number } = {};
    const completedData: { [key: string]: number } = {};

    allIdeas.forEach((idea) => {
      // Track submitted ideas by month
      if (idea.submittedAt) {
        const monthKey = `${idea.submittedAt.getFullYear()}-${String(
          idea.submittedAt.getMonth() + 1
        ).padStart(2, '0')}`;
        submittedData[monthKey] = (submittedData[monthKey] || 0) + 1;
      }

      // Track approved ideas by month
      if (idea.approvedAt) {
        const monthKey = `${idea.approvedAt.getFullYear()}-${String(
          idea.approvedAt.getMonth() + 1
        ).padStart(2, '0')}`;
        approvedData[monthKey] = (approvedData[monthKey] || 0) + 1;
      }

      // Track rejected ideas by month
      if (idea.rejectedAt) {
        const monthKey = `${idea.rejectedAt.getFullYear()}-${String(
          idea.rejectedAt.getMonth() + 1
        ).padStart(2, '0')}`;
        rejectedData[monthKey] = (rejectedData[monthKey] || 0) + 1;
      }

      // Track completed ideas by month
      if (idea.completedAt) {
        const monthKey = `${idea.completedAt.getFullYear()}-${String(
          idea.completedAt.getMonth() + 1
        ).padStart(2, '0')}`;
        completedData[monthKey] = (completedData[monthKey] || 0) + 1;
      }
    });

    // Get all unique months
    const allMonths = new Set([
      ...Object.keys(submittedData),
      ...Object.keys(approvedData),
      ...Object.keys(rejectedData),
      ...Object.keys(completedData),
    ]);

    // Convert to array and sort
    const trend = Array.from(allMonths)
      .sort((a, b) => a.localeCompare(b))
      .map((month) => ({
        month,
        submitted: submittedData[month] || 0,
        approved: approvedData[month] || 0,
        rejected: rejectedData[month] || 0,
        completed: completedData[month] || 0,
      }));

    res.json(trend);
  } catch (error) {
    console.error('Error fetching monthly trend:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get weekly trend data
router.get('/weekly-trend', requireAuth, async (req, res) => {
  try {
    const allIdeas = await prisma.idea.findMany({
      select: {
        status: true,
        submittedAt: true,
        approvedAt: true,
        rejectedAt: true,
        completedAt: true,
      },
    });

    // Helper function to get week key (ISO week format: YYYY-Www)
    function getWeekKey(date: Date): string {
      // Create a copy of the date using local time (not UTC)
      const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());

      // ISO 8601 week date: weeks start on Monday
      // Set to nearest Thursday (current date + 4 - current day number)
      // Make Sunday's day number 7
      const dayNum = d.getDay() === 0 ? 7 : d.getDay();
      d.setDate(d.getDate() + 4 - dayNum);

      // Get year based on the Thursday
      const yearOfThursday = d.getFullYear();

      // Get first day of that year
      const yearStart = new Date(yearOfThursday, 0, 1);

      // Calculate the week number
      const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);

      return `${yearOfThursday}-W${String(weekNo).padStart(2, '0')}`;
    }

    // Group by week for each status
    const submittedData: { [key: string]: number } = {};
    const approvedData: { [key: string]: number } = {};
    const rejectedData: { [key: string]: number } = {};
    const completedData: { [key: string]: number } = {};

    allIdeas.forEach((idea) => {
      // Track submitted ideas by week
      if (idea.submittedAt) {
        const weekKey = getWeekKey(idea.submittedAt);
        submittedData[weekKey] = (submittedData[weekKey] || 0) + 1;
      }

      // Track approved ideas by week
      if (idea.approvedAt) {
        const weekKey = getWeekKey(idea.approvedAt);
        approvedData[weekKey] = (approvedData[weekKey] || 0) + 1;
      }

      // Track rejected ideas by week
      if (idea.rejectedAt) {
        const weekKey = getWeekKey(idea.rejectedAt);
        rejectedData[weekKey] = (rejectedData[weekKey] || 0) + 1;
      }

      // Track completed ideas by week
      if (idea.completedAt) {
        const weekKey = getWeekKey(idea.completedAt);
        completedData[weekKey] = (completedData[weekKey] || 0) + 1;
      }
    });

    // Get all unique weeks
    const allWeeks = new Set([
      ...Object.keys(submittedData),
      ...Object.keys(approvedData),
      ...Object.keys(rejectedData),
      ...Object.keys(completedData),
    ]);

    // Convert to array and sort
    const trend = Array.from(allWeeks)
      .sort((a, b) => a.localeCompare(b))
      .map((week) => ({
        week,
        submitted: submittedData[week] || 0,
        approved: approvedData[week] || 0,
        rejected: rejectedData[week] || 0,
        completed: completedData[week] || 0,
      }));

    res.json(trend);
  } catch (error) {
    console.error('Error fetching weekly trend:', error);
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
    const { status, startDate, endDate, submitterId, assigneeId, tags, format } = req.query;

    const where: any = {};

    if (status) {
      where.status = status;
    }
    if (submitterId) {
      where.submitterId = submitterId;
    }
    if (assigneeId) {
      where.assigneeId = assigneeId;
    }
    if (tags) {
      where.tags = {
        hasSome: Array.isArray(tags) ? tags : [tags],
      };
    }
    if (startDate || endDate) {
      where.submittedAt = {};
      if (startDate) {
        where.submittedAt.gte = new Date(startDate as string);
      }
      if (endDate) {
        where.submittedAt.lte = new Date(endDate as string);
      }
    }

    const ideas = await prisma.idea.findMany({
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
    });

    // If CSV format requested
    if (format === 'csv') {
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
      res.json(ideas);
    }
  } catch (error) {
    console.error('Error fetching filtered report:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
