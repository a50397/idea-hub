import { Router } from 'express';
import { Role, Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { departmentNameSchema, updateDepartmentSchema, reorderDepartmentsSchema, objectIdParamSchema } from '../utils/validation';

const router = Router();

// Shared sort: primary by admin-defined order, tie-break by name for determinism.
const departmentOrderBy: Prisma.DepartmentOrderByWithRelationInput[] = [
  { order: 'asc' },
  { name: 'asc' },
];

// notificationEmails is INTERNAL, admin-only data. Project it onto the wire
// representation ONLY for ADMIN sessions; every other authenticated user receives
// the same id/name/order/_count/timestamps shape as before this feature. Keeping
// the authz projection in one place makes the visibility rule easy to audit — so
// EVERY department-returning path (GET list, create, reorder, update) funnels
// through this one function. Generic over the department shape so it accepts both
// the enriched list row (with _count) and a plain create/update result.
function serializeDepartment<T extends { notificationEmails: string[] }>(
  dept: T,
  includeNotificationEmails: boolean
): T | Omit<T, 'notificationEmails'> {
  if (includeNotificationEmails) {
    return dept;
  }
  const { notificationEmails: _omit, ...rest } = dept;
  return rest;
}

// List all departments (any authenticated user — the submit form needs it).
// Returns a plain array (not the ideas {data,pagination} envelope). Admins also
// receive each department's notificationEmails; non-admins never see them.
router.get('/', requireAuth, async (req, res) => {
  try {
    const isAdmin = req.session.role === Role.ADMIN;
    const departments = await prisma.department.findMany({
      orderBy: departmentOrderBy,
      include: {
        _count: {
          select: { ideas: true },
        },
      },
    });

    res.json(departments.map((d) => serializeDepartment(d, isAdmin)));
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

    // Admin-only route -> include emails, but still funnel through the one
    // projection so no department-returning path bypasses serializeDepartment.
    res.status(201).json(serializeDepartment(department, true));
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

    // Route the response through the central projection instead of returning the
    // raw findMany (which leaks notificationEmails). This route is requireRole
    // (ADMIN), so emails SHOULD be included — pass `true`, exactly what GET's
    // isAdmin evaluates to for an admin — leaving admin behavior unchanged while
    // ensuring no department-returning path bypasses serializeDepartment.
    res.json(departments.map((d) => serializeDepartment(d, true)));
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Update a department (Admin only): rename and/or set its notification emails.
// Both are optional, so a rename-only, an emails-only, or a combined update all
// work. Always allowed, even when the department is referenced by ideas. The
// response is admin-only, so it always carries notificationEmails.
router.patch('/:id', requireRole(Role.ADMIN), async (req, res) => {
  try {
    const idParsed = objectIdParamSchema.safeParse(req.params.id);
    if (!idParsed.success) {
      return res.status(400).json({ error: 'Invalid department ID format' });
    }
    const id = idParsed.data;
    const { name, notificationEmails } = updateDepartmentSchema.parse(req.body);

    // Reject an empty update fast: both fields are optional in the schema, so an
    // empty `{}` body (or one of only unknown keys Zod strips) parses OK yet would
    // reach prisma.update with `data: {}`, turning a client mistake into a 500/no-op.
    if (name === undefined && notificationEmails === undefined) {
      return res
        .status(400)
        .json({ error: 'At least one field to update is required (name or notificationEmails)' });
    }

    const existing = await prisma.department.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Department not found' });
    }

    const department = await prisma.department.update({
      where: { id },
      // Prisma skips `undefined` fields, so an absent name or absent
      // notificationEmails leaves that column untouched. An explicit [] clears.
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(notificationEmails !== undefined ? { notificationEmails } : {}),
      },
    });

    // Admin-only route -> include emails, via the one central projection.
    res.json(serializeDepartment(department, true));
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
