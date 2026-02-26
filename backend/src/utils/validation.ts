import { z } from 'zod';
import { Effort, IdeaStatus } from '@prisma/client';

const ideaStatusEnum = z.nativeEnum(IdeaStatus);
const objectIdRegex = /^[a-f\d]{24}$/i;

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const createIdeaSchema = z.object({
  title: z.string().min(5, 'Title must be at least 5 characters').max(120, 'Title must be at most 120 characters'),
  description: z.string().min(10, 'Description must be at least 10 characters').max(3000, 'Description must be at most 3000 characters'),
  benefits: z.string().min(10, 'Benefits must be at least 10 characters').max(3000, 'Benefits must be at most 3000 characters'),
  effort: z.nativeEnum(Effort, { errorMap: () => ({ message: 'Invalid effort value' }) }),
  tags: z.array(z.string()).optional().default([]),
});

export const updateIdeaSchema = z.object({
  title: z.string().min(5).max(120).optional(),
  description: z.string().min(10).max(3000).optional(),
  benefits: z.string().min(10).max(3000).optional(),
  effort: z.nativeEnum(Effort).optional(),
  tags: z.array(z.string()).optional(),
});

export const reviewIdeaSchema = z.object({
  note: z.string().max(1000).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(6, 'New password must be at least 6 characters'),
});

export const createStepSchema = z.object({
  text: z.string().min(1, 'Step text is required').max(1000, 'Step text must be at most 1000 characters'),
});

export const createUserSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  role: z.enum(['USER', 'POWER_USER', 'ADMIN']).optional().default('USER'),
});

export const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  role: z.enum(['USER', 'POWER_USER', 'ADMIN']).optional(),
});

const paginationSchema = {
  page: z.coerce.number().int().min(1, 'Page must be at least 1').optional().default(1),
  limit: z.coerce.number().int().min(1, 'Limit must be at least 1').max(100, 'Limit must be at most 100').optional().default(20),
};

export const ideasQuerySchema = z.object({
  status: ideaStatusEnum.optional(),
  submitterId: z.string().regex(objectIdRegex, 'Invalid submitter ID').optional(),
  assigneeId: z.string().regex(objectIdRegex, 'Invalid assignee ID').optional(),
  tags: z.union([z.string(), z.array(z.string())]).optional(),
  ...paginationSchema,
});

export const filteredReportQuerySchema = z.object({
  status: ideaStatusEnum.optional(),
  submitterId: z.string().regex(objectIdRegex, 'Invalid submitter ID').optional(),
  assigneeId: z.string().regex(objectIdRegex, 'Invalid assignee ID').optional(),
  tags: z.union([z.string(), z.array(z.string())]).optional(),
  startDate: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  endDate: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  format: z.enum(['json', 'csv']).optional(),
  ...paginationSchema,
});
