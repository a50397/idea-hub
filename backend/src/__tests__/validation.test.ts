import {
  loginSchema,
  createIdeaSchema,
  updateIdeaSchema,
  reviewIdeaSchema,
  changePasswordSchema,
  createUserSchema,
  updateUserSchema,
  ideasQuerySchema,
  filteredReportQuerySchema,
  departmentNameSchema,
  updateDepartmentSchema,
  reorderDepartmentsSchema,
  updateWebexSettingsSchema,
} from '../utils/validation';

// A valid ObjectId used wherever a schema now requires/accepts a department id.
const VALID_OBJECT_ID = '507f1f77bcf86cd799439011';
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
        departmentId: VALID_OBJECT_ID,
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
        departmentId: VALID_OBJECT_ID,
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
        departmentId: VALID_OBJECT_ID,
      };

      const result = createIdeaSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    test('should reject a missing departmentId (now required)', () => {
      const result = createIdeaSchema.safeParse({
        title: 'Valid Title',
        description: 'Valid description with enough characters',
        benefits: 'Valid benefits with enough characters',
        effort: Effort.ONE_TO_THREE_DAYS,
      });
      expect(result.success).toBe(false);
    });

    test('should reject an invalid departmentId format', () => {
      const result = createIdeaSchema.safeParse({
        title: 'Valid Title',
        description: 'Valid description with enough characters',
        benefits: 'Valid benefits with enough characters',
        effort: Effort.ONE_TO_THREE_DAYS,
        departmentId: 'not-an-object-id',
      });
      expect(result.success).toBe(false);
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

    test('should accept an optional departmentId', () => {
      const result = updateIdeaSchema.safeParse({ departmentId: VALID_OBJECT_ID });
      expect(result.success).toBe(true);
    });

    test('should reject an invalid departmentId', () => {
      const result = updateIdeaSchema.safeParse({ departmentId: 'bad' });
      expect(result.success).toBe(false);
    });
  });

  describe('departmentNameSchema', () => {
    test('should validate a valid name', () => {
      const result = departmentNameSchema.safeParse({ name: 'Marketing' });
      expect(result.success).toBe(true);
    });

    test('should trim surrounding whitespace', () => {
      const result = departmentNameSchema.safeParse({ name: '  Marketing  ' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Marketing');
      }
    });

    test('should reject an empty or whitespace-only name', () => {
      expect(departmentNameSchema.safeParse({ name: '' }).success).toBe(false);
      expect(departmentNameSchema.safeParse({ name: '   ' }).success).toBe(false);
    });

    test('should reject a name longer than 100 characters', () => {
      const result = departmentNameSchema.safeParse({ name: 'A'.repeat(101) });
      expect(result.success).toBe(false);
    });

    test('should accept a name of exactly 100 characters', () => {
      const result = departmentNameSchema.safeParse({ name: 'A'.repeat(100) });
      expect(result.success).toBe(true);
    });
  });

  describe('reorderDepartmentsSchema', () => {
    test('should validate a non-empty array of ids', () => {
      const result = reorderDepartmentsSchema.safeParse({ ids: ['a', 'b', 'c'] });
      expect(result.success).toBe(true);
    });

    test('should reject an empty array', () => {
      const result = reorderDepartmentsSchema.safeParse({ ids: [] });
      expect(result.success).toBe(false);
    });

    test('should reject a non-array ids value', () => {
      const result = reorderDepartmentsSchema.safeParse({ ids: 'not-an-array' });
      expect(result.success).toBe(false);
    });

    test('should reject a missing ids field', () => {
      const result = reorderDepartmentsSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('updateDepartmentSchema — notificationEmails case-insensitive dedupe', () => {
    test('removes an exact-duplicate email, preserving order', () => {
      const result = updateDepartmentSchema.safeParse({
        notificationEmails: ['a@corp.example', 'b@corp.example', 'a@corp.example'],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.notificationEmails).toEqual(['a@corp.example', 'b@corp.example']);
      }
    });

    test('removes a CASE-VARIANT duplicate, keeping the FIRST occurrence as-typed', () => {
      const result = updateDepartmentSchema.safeParse({
        notificationEmails: ['User@X.com', 'user@x.com', 'other@corp.example'],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        // The stored value keeps the first occurrence's original casing (email
        // local-parts are technically case-sensitive); only the later case-variant
        // is dropped — we never lowercase what gets stored.
        expect(result.data.notificationEmails).toEqual(['User@X.com', 'other@corp.example']);
      }
    });

    test('trims each entry then de-duplicates case-insensitively, preserving order', () => {
      const result = updateDepartmentSchema.safeParse({
        notificationEmails: ['  ops@corp.example  ', 'OPS@corp.example', 'lead@corp.example'],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.notificationEmails).toEqual(['ops@corp.example', 'lead@corp.example']);
      }
    });

    test('leaves distinct emails (and an empty array) untouched', () => {
      const distinct = updateDepartmentSchema.safeParse({
        notificationEmails: ['a@corp.example', 'b@corp.example', 'c@corp.example'],
      });
      expect(distinct.success).toBe(true);
      if (distinct.success) {
        expect(distinct.data.notificationEmails).toEqual([
          'a@corp.example',
          'b@corp.example',
          'c@corp.example',
        ]);
      }
      const empty = updateDepartmentSchema.safeParse({ notificationEmails: [] });
      expect(empty.success).toBe(true);
      if (empty.success) {
        expect(empty.data.notificationEmails).toEqual([]);
      }
    });
  });

  describe('updateWebexSettingsSchema — bot token trim/reject/keep/wipe', () => {
    test('trims surrounding whitespace from a real token before it is stored', () => {
      const result = updateWebexSettingsSchema.safeParse({
        enabled: true,
        language: 'en',
        token: '  tok123  ',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        // A real token is trimmed before the route encrypts/stores it.
        expect(result.data.token).toBe('tok123');
      }
    });

    test('rejects a whitespace-only token with the whitespace message', () => {
      const result = updateWebexSettingsSchema.safeParse({
        enabled: true,
        language: 'en',
        token: '   ',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        // A whitespace-only token would encrypt to an unusable credential yet still
        // make effectiveEnabled true (token.length > 0), so validation blocks it.
        expect(result.error.issues[0].message).toContain('Token cannot be only whitespace');
      }
    });

    test('preserves an empty-string token as the explicit WIPE signal', () => {
      const result = updateWebexSettingsSchema.safeParse({
        enabled: false,
        language: 'sk',
        token: '',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.token).toBe('');
      }
    });

    test('leaves an omitted token undefined (the KEEP signal)', () => {
      const result = updateWebexSettingsSchema.safeParse({
        enabled: false,
        language: 'sk',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.token).toBeUndefined();
      }
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

  describe('changePasswordSchema', () => {
    test('should validate valid change password data', () => {
      const validData = {
        currentPassword: 'oldpassword',
        newPassword: 'newpassword123',
      };

      const result = changePasswordSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    test('should reject missing currentPassword', () => {
      const invalidData = {
        newPassword: 'newpassword123',
      };

      const result = changePasswordSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    test('should reject empty currentPassword', () => {
      const invalidData = {
        currentPassword: '',
        newPassword: 'newpassword123',
      };

      const result = changePasswordSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    test('should reject missing newPassword', () => {
      const invalidData = {
        currentPassword: 'oldpassword',
      };

      const result = changePasswordSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    test('should reject newPassword too short', () => {
      const invalidData = {
        currentPassword: 'oldpassword',
        newPassword: '12345',
      };

      const result = changePasswordSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('at least 12 characters');
      }
    });

    test('should accept newPassword with exactly 12 characters', () => {
      const validData = {
        currentPassword: 'oldpassword',
        newPassword: '123456789012',
      };

      const result = changePasswordSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });
  });

  describe('createUserSchema', () => {
    test('should validate valid user data', () => {
      const validData = {
        name: 'John Doe',
        email: 'john@example.com',
        password: 'password1234',
        role: 'USER',
      };

      const result = createUserSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    test('should default to USER role', () => {
      const validData = {
        name: 'John Doe',
        email: 'john@example.com',
        password: 'password1234',
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
          password: 'password1234',
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

  describe('ideasQuerySchema', () => {
    test('should validate empty query (no filters)', () => {
      const result = ideasQuerySchema.safeParse({});
      expect(result.success).toBe(true);
    });

    test('should validate valid status filter', () => {
      const result = ideasQuerySchema.safeParse({ status: 'APPROVED' });
      expect(result.success).toBe(true);
    });

    test('should reject invalid status', () => {
      const result = ideasQuerySchema.safeParse({ status: 'INVALID' });
      expect(result.success).toBe(false);
    });

    test('should validate valid ObjectId for submitterId', () => {
      const result = ideasQuerySchema.safeParse({ submitterId: '507f1f77bcf86cd799439011' });
      expect(result.success).toBe(true);
    });

    test('should reject invalid submitterId', () => {
      const result = ideasQuerySchema.safeParse({ submitterId: 'not-an-id' });
      expect(result.success).toBe(false);
    });

    test('should validate valid ObjectId for assigneeId', () => {
      const result = ideasQuerySchema.safeParse({ assigneeId: '507f1f77bcf86cd799439011' });
      expect(result.success).toBe(true);
    });

    test('should reject invalid assigneeId', () => {
      const result = ideasQuerySchema.safeParse({ assigneeId: '123' });
      expect(result.success).toBe(false);
    });

    test('should validate tags as string', () => {
      const result = ideasQuerySchema.safeParse({ tags: 'automation' });
      expect(result.success).toBe(true);
    });

    test('should validate tags as array', () => {
      const result = ideasQuerySchema.safeParse({ tags: ['automation', 'process'] });
      expect(result.success).toBe(true);
    });

    test('should validate a valid departmentId', () => {
      const result = ideasQuerySchema.safeParse({ departmentId: VALID_OBJECT_ID });
      expect(result.success).toBe(true);
    });

    test('should reject an invalid departmentId', () => {
      const result = ideasQuerySchema.safeParse({ departmentId: 'nope' });
      expect(result.success).toBe(false);
    });
  });

  describe('filteredReportQuerySchema', () => {
    test('should validate empty query', () => {
      const result = filteredReportQuerySchema.safeParse({});
      expect(result.success).toBe(true);
    });

    test('should validate all filters combined', () => {
      const result = filteredReportQuerySchema.safeParse({
        status: 'DONE',
        submitterId: '507f1f77bcf86cd799439011',
        assigneeId: '607f1f77bcf86cd799439022',
        tags: ['test'],
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        format: 'csv',
      });
      expect(result.success).toBe(true);
    });

    test('should reject invalid status', () => {
      const result = filteredReportQuerySchema.safeParse({ status: 'BOGUS' });
      expect(result.success).toBe(false);
    });

    test('should validate ISO date string for startDate', () => {
      const result = filteredReportQuerySchema.safeParse({ startDate: '2024-01-01' });
      expect(result.success).toBe(true);
    });

    test('should validate ISO datetime string for startDate', () => {
      const result = filteredReportQuerySchema.safeParse({ startDate: '2024-01-01T00:00:00Z' });
      expect(result.success).toBe(true);
    });

    test('should reject invalid date format', () => {
      const result = filteredReportQuerySchema.safeParse({ startDate: 'not-a-date' });
      expect(result.success).toBe(false);
    });

    test('should accept format=json', () => {
      const result = filteredReportQuerySchema.safeParse({ format: 'json' });
      expect(result.success).toBe(true);
    });

    test('should accept format=csv', () => {
      const result = filteredReportQuerySchema.safeParse({ format: 'csv' });
      expect(result.success).toBe(true);
    });

    test('should reject invalid format', () => {
      const result = filteredReportQuerySchema.safeParse({ format: 'xml' });
      expect(result.success).toBe(false);
    });

    test('should reject invalid submitterId', () => {
      const result = filteredReportQuerySchema.safeParse({ submitterId: 'bad' });
      expect(result.success).toBe(false);
    });

    test('should validate a valid departmentId', () => {
      const result = filteredReportQuerySchema.safeParse({ departmentId: VALID_OBJECT_ID });
      expect(result.success).toBe(true);
    });

    test('should reject an invalid departmentId', () => {
      const result = filteredReportQuerySchema.safeParse({ departmentId: 'bad' });
      expect(result.success).toBe(false);
    });
  });

  describe('Pagination parameters', () => {
    test('should use default page and limit', () => {
      const result = ideasQuerySchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(1);
        expect(result.data.limit).toBe(20);
      }
    });

    test('should accept valid page and limit', () => {
      const result = ideasQuerySchema.safeParse({ page: '2', limit: '50' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(2);
        expect(result.data.limit).toBe(50);
      }
    });

    test('should reject page less than 1', () => {
      const result = ideasQuerySchema.safeParse({ page: '0' });
      expect(result.success).toBe(false);
    });

    test('should reject limit greater than 100', () => {
      const result = ideasQuerySchema.safeParse({ limit: '101' });
      expect(result.success).toBe(false);
    });

    test('should coerce string numbers to integers', () => {
      const result = filteredReportQuerySchema.safeParse({ page: '3', limit: '10' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(3);
        expect(result.data.limit).toBe(10);
      }
    });

    test('should reject non-integer page', () => {
      const result = ideasQuerySchema.safeParse({ page: '1.5' });
      expect(result.success).toBe(false);
    });
  });
});
