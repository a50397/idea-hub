import { z } from 'zod';
import { Effort, IdeaStatus } from '@prisma/client';

const ideaStatusEnum = z.nativeEnum(IdeaStatus);
export const objectIdRegex = /^[a-f\d]{24}$/i;

export const objectIdParamSchema = z.string().regex(objectIdRegex, 'Invalid ID format');

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
  // departmentId is optional in the Prisma schema (legacy docs) but REQUIRED here:
  // every new idea targets a department. Existence is verified in the handler.
  departmentId: z.string().regex(objectIdRegex, 'Invalid department ID'),
});

export const updateIdeaSchema = z.object({
  title: z.string().min(5).max(120).optional(),
  description: z.string().min(10).max(3000).optional(),
  benefits: z.string().min(10).max(3000).optional(),
  effort: z.nativeEnum(Effort).optional(),
  tags: z.array(z.string()).optional(),
  departmentId: z.string().regex(objectIdRegex, 'Invalid department ID').optional(),
});

export const departmentNameSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name must be at most 100 characters'),
});

// PATCH /api/departments/:id accepts a rename, a notification-emails update, or
// both — every field is optional, so rename-only and emails-only requests each
// work. Each notification email is trimmed then validated; the raw array is capped
// at 20 entries; valid entries are de-duplicated (exact match). An empty array is
// allowed and clears the list.
export const updateDepartmentSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(100, 'Name must be at most 100 characters')
    .optional(),
  notificationEmails: z
    .array(z.string().trim().email('Invalid notification email address'))
    .max(20, 'At most 20 notification emails are allowed')
    .transform((emails) => [...new Set(emails)])
    .optional(),
});

export const reorderDepartmentsSchema = z.object({
  ids: z.array(z.string()).min(1, 'ids must be a non-empty array'),
});

// PUT /api/mail-settings — full save of the singleton admin-managed mail config.
// `password` is the ONLY optional field: when present and non-empty it is
// encrypted and stored; when absent or empty the existing stored password is kept
// (or wiped when `username` is saved empty). The enabled-requires-host rule is
// enforced in the route handler so it can return a house-style message. `host` is
// bounded to the max DNS name length (253); `from`/`username`/`subjectTemplate`
// are trimmed and bounded; `language` is the en|sk enum.
export const updateMailSettingsSchema = z.object({
  enabled: z.boolean(),
  host: z.string().trim().max(253, 'Host must be at most 253 characters'),
  port: z
    .number({ invalid_type_error: 'Port must be a number' })
    .int('Port must be an integer')
    .min(1, 'Port must be at least 1')
    .max(65535, 'Port must be at most 65535'),
  secure: z.boolean(),
  username: z.string().trim().max(128, 'Username must be at most 128 characters'),
  password: z.string().max(256, 'Password must be at most 256 characters').optional(),
  from: z
    .string()
    .trim()
    .min(1, 'From address is required')
    .max(128, 'From address must be at most 128 characters'),
  language: z.enum(['en', 'sk'], { errorMap: () => ({ message: 'Language must be en or sk' }) }),
  subjectTemplate: z
    .string()
    .trim()
    .max(200, 'Subject template must be at most 200 characters'),
});

// POST /api/mail-settings/test — send a short test mail to a single address.
export const mailTestSendSchema = z.object({
  to: z.string().trim().email('Invalid email address'),
});

export const reviewIdeaSchema = z.object({
  note: z.string().max(1000).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(12, 'New password must be at least 12 characters'),
});

export const createStepSchema = z.object({
  text: z.string().min(1, 'Step text is required').max(1000, 'Step text must be at most 1000 characters'),
});

export const createUserSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(12, 'Password must be at least 12 characters'),
  role: z.enum(['USER', 'POWER_USER', 'ADMIN']).optional().default('USER'),
});

export const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  password: z.string().min(12).optional(),
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
  departmentId: z.string().regex(objectIdRegex, 'Invalid department ID').optional(),
  tags: z.union([z.string(), z.array(z.string())]).optional(),
  ...paginationSchema,
});

export const filteredReportQuerySchema = z.object({
  status: ideaStatusEnum.optional(),
  submitterId: z.string().regex(objectIdRegex, 'Invalid submitter ID').optional(),
  assigneeId: z.string().regex(objectIdRegex, 'Invalid assignee ID').optional(),
  departmentId: z.string().regex(objectIdRegex, 'Invalid department ID').optional(),
  tags: z.union([z.string(), z.array(z.string())]).optional(),
  startDate: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  endDate: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  format: z.enum(['json', 'csv']).optional(),
  ...paginationSchema,
});
