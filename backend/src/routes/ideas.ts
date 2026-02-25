import { Router } from 'express';
import { IdeaStatus, EventType, Role } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { createIdeaSchema, reviewIdeaSchema, updateIdeaSchema } from '../utils/validation';

const router = Router();

// Get all ideas with filters
router.get('/', requireAuth, async (req, res) => {
  try {
    const { status, submitterId, assigneeId, tags } = req.query;

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

    res.json(ideas);
  } catch (error) {
    console.error('Error fetching ideas:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single idea
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

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

    const idea = await prisma.idea.create({
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

    // Create event
    await prisma.ideaEvent.create({
      data: {
        ideaId: idea.id,
        type: EventType.SUBMITTED,
        byUserId: userId,
        note: 'Initial submission',
      },
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
    const { id } = req.params;
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

    const updatedIdea = await prisma.idea.update({
      where: { id },
      data,
      include: {
        submitter: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    // Create event
    await prisma.ideaEvent.create({
      data: {
        ideaId: id,
        type: EventType.UPDATED,
        byUserId: userId,
        note: 'Idea updated',
      },
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
    const { id } = req.params;
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

    const updatedIdea = await prisma.idea.update({
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

    // Create event
    await prisma.ideaEvent.create({
      data: {
        ideaId: id,
        type: EventType.APPROVED,
        byUserId: userId,
        note: note || 'Idea approved',
      },
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
    const { id } = req.params;
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

    const updatedIdea = await prisma.idea.update({
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

    // Create event
    await prisma.ideaEvent.create({
      data: {
        ideaId: id,
        type: EventType.REJECTED,
        byUserId: userId,
        note: note || 'Idea rejected',
      },
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
    const { id } = req.params;
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

    const updatedIdea = await prisma.idea.update({
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

    // Create event
    await prisma.ideaEvent.create({
      data: {
        ideaId: id,
        type: EventType.CLAIMED,
        byUserId: userId,
        note: 'Claimed and started working on idea',
      },
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
    const { id } = req.params;
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

    const updatedIdea = await prisma.idea.update({
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

    // Create event
    await prisma.ideaEvent.create({
      data: {
        ideaId: id,
        type: EventType.COMPLETED,
        byUserId: userId,
        note: note || 'Idea completed',
      },
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

export default router;
