import {
  loginSchema,
  createIdeaSchema,
  updateIdeaSchema,
  reviewIdeaSchema,
  createUserSchema,
  updateUserSchema,
} from '../utils/validation';
import { Effort } from '@prisma/client';

describe('Validation Schemas', () => {
  describe('loginSchema', () => {
    test('should validate valid login data', () => {
      const validData = {
        email: 'test@example.com',
        password: 'password123',
      };

      const result = loginSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    test('should reject invalid email', () => {
      const invalidData = {
        email: 'not-an-email',
        password: 'password123',
      };

      const result = loginSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    test('should reject missing password', () => {
      const invalidData = {
        email: 'test@example.com',
      };

      const result = loginSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    test('should reject empty password', () => {
      const invalidData = {
        email: 'test@example.com',
        password: '',
      };

      const result = loginSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });
  });

  describe('createIdeaSchema', () => {
    test('should validate valid idea data', () => {
      const validData = {
        title: 'Test Idea Title',
        description: 'This is a valid description with enough characters',
        benefits: 'These are the benefits with enough characters',
        effort: Effort.ONE_TO_THREE_DAYS,
        tags: ['test', 'automation'],
      };

      const result = createIdeaSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    test('should reject title too short', () => {
      const invalidData = {
        title: 'Bad',
        description: 'Valid description',
        benefits: 'Valid benefits',
        effort: Effort.ONE_TO_THREE_DAYS,
      };

      const result = createIdeaSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('at least 5 characters');
      }
    });

    test('should reject title too long', () => {
      const invalidData = {
        title: 'A'.repeat(121),
        description: 'Valid description with enough characters',
        benefits: 'Valid benefits with enough characters',
        effort: Effort.ONE_TO_THREE_DAYS,
      };

      const result = createIdeaSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    test('should reject description too short', () => {
      const invalidData = {
        title: 'Valid Title',
        description: 'Short',
        benefits: 'Valid benefits here',
        effort: Effort.ONE_TO_THREE_DAYS,
      };

      const result = createIdeaSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    test('should reject description too long', () => {
      const invalidData = {
        title: 'Valid Title',
        description: 'A'.repeat(3001),
        benefits: 'Valid benefits',
        effort: Effort.ONE_TO_THREE_DAYS,
      };

      const result = createIdeaSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    test('should reject invalid effort value', () => {
      const invalidData = {
        title: 'Valid Title',
        description: 'Valid description',
        benefits: 'Valid benefits',
        effort: 'INVALID_EFFORT',
      };

      const result = createIdeaSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    test('should default tags to empty array if not provided', () => {
      const validData = {
        title: 'Valid Title',
        description: 'Valid description with enough characters',
        benefits: 'Valid benefits with enough characters',
        effort: Effort.ONE_TO_THREE_DAYS,
      };

      const result = createIdeaSchema.safeParse(validData);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tags).toEqual([]);
      }
    });

    test('should accept valid tags array', () => {
      const validData = {
        title: 'Valid Title',
        description: 'Valid description',
        benefits: 'Valid benefits',
        effort: Effort.ONE_TO_THREE_DAYS,
        tags: ['productivity', 'automation', 'process'],
      };

      const result = createIdeaSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });
  });

  describe('updateIdeaSchema', () => {
    test('should validate partial updates', () => {
      const validData = {
        title: 'Updated Title',
      };

      const result = updateIdeaSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    test('should validate multiple fields', () => {
      const validData = {
        title: 'Updated Title',
        description: 'Updated description with enough characters',
        effort: Effort.MORE_THAN_THREE_DAYS,
      };

      const result = updateIdeaSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    test('should reject invalid title length', () => {
      const invalidData = {
        title: 'Bad',
      };

      const result = updateIdeaSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    test('should allow empty object (no updates)', () => {
      const result = updateIdeaSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('reviewIdeaSchema', () => {
    test('should validate optional note', () => {
      const validData = {
        note: 'Great idea! Approved.',
      };

      const result = reviewIdeaSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    test('should allow empty object', () => {
      const result = reviewIdeaSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    test('should reject note too long', () => {
      const invalidData = {
        note: 'A'.repeat(1001),
      };

      const result = reviewIdeaSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });
  });

  describe('createUserSchema', () => {
    test('should validate valid user data', () => {
      const validData = {
        name: 'John Doe',
        email: 'john@example.com',
        password: 'password123',
        role: 'USER',
      };

      const result = createUserSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    test('should default to USER role', () => {
      const validData = {
        name: 'John Doe',
        email: 'john@example.com',
        password: 'password123',
      };

      const result = createUserSchema.safeParse(validData);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.role).toBe('USER');
      }
    });

    test('should reject name too short', () => {
      const invalidData = {
        name: 'J',
        email: 'john@example.com',
        password: 'password123',
      };

      const result = createUserSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    test('should reject invalid email', () => {
      const invalidData = {
        name: 'John Doe',
        email: 'not-an-email',
        password: 'password123',
      };

      const result = createUserSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    test('should reject password too short', () => {
      const invalidData = {
        name: 'John Doe',
        email: 'john@example.com',
        password: '12345',
      };

      const result = createUserSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    test('should accept all valid roles', () => {
      const roles = ['USER', 'POWER_USER', 'ADMIN'];

      roles.forEach((role) => {
        const data = {
          name: 'John Doe',
          email: 'john@example.com',
          password: 'password123',
          role,
        };

        const result = createUserSchema.safeParse(data);
        expect(result.success).toBe(true);
      });
    });

    test('should reject invalid role', () => {
      const invalidData = {
        name: 'John Doe',
        email: 'john@example.com',
        password: 'password123',
        role: 'SUPER_USER',
      };

      const result = createUserSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });
  });

  describe('updateUserSchema', () => {
    test('should validate partial user updates', () => {
      const validData = {
        name: 'New Name',
      };

      const result = updateUserSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    test('should validate password update', () => {
      const validData = {
        password: 'newpassword123',
      };

      const result = updateUserSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    test('should validate role update', () => {
      const validData = {
        role: 'POWER_USER',
      };

      const result = updateUserSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    test('should reject short password in update', () => {
      const invalidData = {
        password: '12345',
      };

      const result = updateUserSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    test('should allow empty object (no updates)', () => {
      const result = updateUserSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });
});
