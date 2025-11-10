import { z } from 'zod';
import { Effort } from '@prisma/client';

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
