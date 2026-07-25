import { Router } from 'express';
import { Role, Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { departmentNameSchema, reorderDepartmentsSchema, objectIdParamSchema } from '../utils/validation';

const router = Router();

// Shared sort: primary by admin-defined order, tie-break by name for determinism.
const departmentOrderBy: Prisma.DepartmentOrderByWithRelationInput[] = [
  { order: 'asc' },
  { name: 'asc' },
];

// List all departments (any authenticated user — the submit form needs it).
// Returns a plain array (not the ideas {data,pagination} envelope).
router.get('/', requireAuth, async (req, res) => {
  try {
    const departments = await prisma.department.findMany({
      orderBy: departmentOrderBy,
      include: {
        _count: {
          select: { ideas: true },
        },
      },
    });

    res.json(departments);
  } catch (error) {
    console.error('Error fetching departments:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a department (Admin only). New department is appended (max order + 1).
router.post('/', requireRole(Role.ADMIN), async (req, res) => {
  try {
    const { name } = departmentNameSchema.parse(req.body);

    const highest = await prisma.department.findFirst({
      orderBy: { order: 'desc' },
    });
    const nextOrder = highest ? highest.order + 1 : 0;

    const department = await prisma.department.create({
      data: { name, order: nextOrder },
    });

    res.status(201).json(department);
  } catch (error) {
    if (error && typeof error === 'object' && (error as { code?: string }).code === 'P2002') {
      return res.status(409).json({ error: 'A department with this name already exists' });
    }
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Reorder all departments (Admin only). MUST be registered before PATCH /:id so
// the literal path wins over the parameter route. Body is an exact permutation of
// every current department id; the new order is the array index.
router.patch('/reorder', requireRole(Role.ADMIN), async (req, res) => {
  try {
    const { ids } = reorderDepartmentsSchema.parse(req.body);

    const current = await prisma.department.findMany({ select: { id: true } });
    const currentIds = current.map((d) => d.id);

    const sameSize = ids.length === currentIds.length;
    const noDuplicates = new Set(ids).size === ids.length;
    const sameSet = ids.every((id) => currentIds.includes(id));

    if (!sameSize || !noDuplicates || !sameSet) {
      return res.status(400).json({
        error: 'ids must be an exact permutation of all department ids',
      });
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await Promise.all(
        ids.map((id, index) => tx.department.update({ where: { id }, data: { order: index } }))
      );
    });

    const departments = await prisma.department.findMany({
      orderBy: departmentOrderBy,
      include: {
        _count: {
          select: { ideas: true },
        },
      },
    });

    res.json(departments);
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Rename a department (Admin only). Always allowed, even when referenced by ideas.
router.patch('/:id', requireRole(Role.ADMIN), async (req, res) => {
  try {
    const idParsed = objectIdParamSchema.safeParse(req.params.id);
    if (!idParsed.success) {
      return res.status(400).json({ error: 'Invalid department ID format' });
    }
    const id = idParsed.data;
    const { name } = departmentNameSchema.parse(req.body);

    const existing = await prisma.department.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Department not found' });
    }

    const department = await prisma.department.update({
      where: { id },
      data: { name },
    });

    res.json(department);
  } catch (error) {
    if (error && typeof error === 'object' && (error as { code?: string }).code === 'P2002') {
      return res.status(409).json({ error: 'A department with this name already exists' });
    }
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Delete a department (Admin only). Blocked while it still has ideas or when it
// is the last remaining department.
router.delete('/:id', requireRole(Role.ADMIN), async (req, res) => {
  try {
    const idParsed = objectIdParamSchema.safeParse(req.params.id);
    if (!idParsed.success) {
      return res.status(400).json({ error: 'Invalid department ID format' });
    }
    const id = idParsed.data;

    const existing = await prisma.department.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Department not found' });
    }

    const ideaCount = await prisma.idea.count({ where: { departmentId: id } });
    if (ideaCount > 0) {
      return res.status(409).json({
        error: 'Cannot delete a department that still has ideas',
      });
    }

    const departmentCount = await prisma.department.count();
    if (departmentCount <= 1) {
      return res.status(409).json({
        error: 'Cannot delete the last remaining department',
      });
    }

    await prisma.department.delete({ where: { id } });

    res.json({ message: 'Department deleted successfully' });
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

export default router;
