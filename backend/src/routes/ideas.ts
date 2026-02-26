import { Router } from 'express';
import { IdeaStatus, EventType, Role, Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { createIdeaSchema, reviewIdeaSchema, updateIdeaSchema, ideasQuerySchema, createStepSchema } from '../utils/validation';

const router = Router();

// Get all ideas with filters
router.get('/', requireAuth, async (req, res) => {
  try {
    const parsed = ideasQuerySchema.safeParse(req.query);
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

    res.json({
      data: ideas,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching ideas:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single idea
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const id = req.params.id as string;

    const idea = await prisma.idea.findUnique({
      where: { id },
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
        events: {
          include: {
            byUser: {
              select: { id: true, name: true, email: true },
            },
          },
          orderBy: { timestamp: 'asc' },
        },
        steps: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!idea) {
      return res.status(404).json({ error: 'Idea not found' });
    }

    res.json(idea);
  } catch (error) {
    console.error('Error fetching idea:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new idea
router.post('/', requireAuth, async (req, res) => {
  try {
    const data = createIdeaSchema.parse(req.body);
    const userId = req.session.userId!;

    const idea = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.idea.create({
        data: {
          ...data,
          submitterId: userId,
          status: IdeaStatus.SUBMITTED,
        },
        include: {
          submitter: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      await tx.ideaEvent.create({
        data: {
          ideaId: created.id,
          type: EventType.SUBMITTED,
          byUserId: userId,
          note: 'Initial submission',
        },
      });

      return created;
    });

    res.status(201).json(idea);
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Update idea (only by submitter)
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const id = req.params.id as string;
    const userId = req.session.userId!;
    const data = updateIdeaSchema.parse(req.body);

    const existingIdea = await prisma.idea.findUnique({
      where: { id },
    });

    if (!existingIdea) {
      return res.status(404).json({ error: 'Idea not found' });
    }

    // Only submitter can update, and only if not yet approved/rejected
    if (existingIdea.submitterId !== userId) {
      return res.status(403).json({ error: 'You can only update your own ideas' });
    }

    if (existingIdea.status !== IdeaStatus.SUBMITTED) {
      return res.status(400).json({ error: 'Can only update ideas in SUBMITTED status' });
    }

    const updatedIdea = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.idea.update({
        where: { id },
        data,
        include: {
          submitter: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      await tx.ideaEvent.create({
        data: {
          ideaId: id,
          type: EventType.UPDATED,
          byUserId: userId,
          note: 'Idea updated',
        },
      });

      return updated;
    });

    res.json(updatedIdea);
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Approve idea (Power User or Admin only)
router.patch('/:id/approve', requireRole(Role.POWER_USER, Role.ADMIN), async (req, res) => {
  try {
    const id = req.params.id as string;
    const userId = req.session.userId!;
    const { note } = reviewIdeaSchema.parse(req.body);

    const existingIdea = await prisma.idea.findUnique({
      where: { id },
    });

    if (!existingIdea) {
      return res.status(404).json({ error: 'Idea not found' });
    }

    if (existingIdea.status !== IdeaStatus.SUBMITTED) {
      return res.status(400).json({ error: 'Can only approve ideas in SUBMITTED status' });
    }

    const updatedIdea = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.idea.update({
        where: { id },
        data: {
          status: IdeaStatus.APPROVED,
          approverId: userId,
          approvedAt: new Date(),
        },
        include: {
          submitter: {
            select: { id: true, name: true, email: true },
          },
          approver: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      await tx.ideaEvent.create({
        data: {
          ideaId: id,
          type: EventType.APPROVED,
          byUserId: userId,
          note: note || 'Idea approved',
        },
      });

      return updated;
    });

    // TODO: Send notification to submitter
    console.log(`[NOTIFICATION] Idea "${updatedIdea.title}" approved by ${req.session.name}`);

    res.json(updatedIdea);
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Reject idea (Power User or Admin only)
router.patch('/:id/reject', requireRole(Role.POWER_USER, Role.ADMIN), async (req, res) => {
  try {
    const id = req.params.id as string;
    const userId = req.session.userId!;
    const { note } = reviewIdeaSchema.parse(req.body);

    const existingIdea = await prisma.idea.findUnique({
      where: { id },
    });

    if (!existingIdea) {
      return res.status(404).json({ error: 'Idea not found' });
    }

    if (existingIdea.status !== IdeaStatus.SUBMITTED) {
      return res.status(400).json({ error: 'Can only reject ideas in SUBMITTED status' });
    }

    const updatedIdea = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.idea.update({
        where: { id },
        data: {
          status: IdeaStatus.REJECTED,
          approverId: userId,
          rejectedAt: new Date(),
        },
        include: {
          submitter: {
            select: { id: true, name: true, email: true },
          },
          approver: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      await tx.ideaEvent.create({
        data: {
          ideaId: id,
          type: EventType.REJECTED,
          byUserId: userId,
          note: note || 'Idea rejected',
        },
      });

      return updated;
    });

    res.json(updatedIdea);
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Claim idea (start working on approved idea)
router.patch('/:id/claim', requireAuth, async (req, res) => {
  try {
    const id = req.params.id as string;
    const userId = req.session.userId!;

    const existingIdea = await prisma.idea.findUnique({
      where: { id },
    });

    if (!existingIdea) {
      return res.status(404).json({ error: 'Idea not found' });
    }

    if (existingIdea.status !== IdeaStatus.APPROVED) {
      return res.status(400).json({ error: 'Can only claim ideas in APPROVED status' });
    }

    const updatedIdea = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.idea.update({
        where: { id },
        data: {
          status: IdeaStatus.IN_PROGRESS,
          assigneeId: userId,
          startedAt: new Date(),
        },
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
      });

      await tx.ideaEvent.create({
        data: {
          ideaId: id,
          type: EventType.CLAIMED,
          byUserId: userId,
          note: 'Claimed and started working on idea',
        },
      });

      return updated;
    });

    res.json(updatedIdea);
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Complete idea (only by assignee)
router.patch('/:id/complete', requireAuth, async (req, res) => {
  try {
    const id = req.params.id as string;
    const userId = req.session.userId!;
    const { note } = reviewIdeaSchema.parse(req.body);

    const existingIdea = await prisma.idea.findUnique({
      where: { id },
    });

    if (!existingIdea) {
      return res.status(404).json({ error: 'Idea not found' });
    }

    if (existingIdea.status !== IdeaStatus.IN_PROGRESS) {
      return res.status(400).json({ error: 'Can only complete ideas in IN_PROGRESS status' });
    }

    if (existingIdea.assigneeId !== userId) {
      return res.status(403).json({ error: 'Only the assignee can complete this idea' });
    }

    const updatedIdea = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.idea.update({
        where: { id },
        data: {
          status: IdeaStatus.DONE,
          completedAt: new Date(),
        },
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
      });

      await tx.ideaEvent.create({
        data: {
          ideaId: id,
          type: EventType.COMPLETED,
          byUserId: userId,
          note: note || 'Idea completed',
        },
      });

      return updated;
    });

    res.json(updatedIdea);
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Add a progress step to an idea (assignee only, IN_PROGRESS only)
router.post('/:id/steps', requireAuth, async (req, res) => {
  try {
    const id = req.params.id as string;
    const userId = req.session.userId!;
    const data = createStepSchema.parse(req.body);

    const existingIdea = await prisma.idea.findUnique({
      where: { id },
    });

    if (!existingIdea) {
      return res.status(404).json({ error: 'Idea not found' });
    }

    if (existingIdea.status !== IdeaStatus.IN_PROGRESS) {
      return res.status(400).json({ error: 'Can only add steps to ideas in IN_PROGRESS status' });
    }

    if (existingIdea.assigneeId !== userId) {
      return res.status(403).json({ error: 'Only the assignee can add steps' });
    }

    const step = await prisma.ideaStep.create({
      data: {
        ideaId: id,
        text: data.text,
      },
    });

    res.status(201).json(step);
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

export default router;
