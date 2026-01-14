import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ideasApi } from '../ideas';
import client from '../client';

// Mock the client
vi.mock('../client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('Ideas API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAll', () => {
    it('should fetch all ideas without filters', async () => {
      const mockIdeas = [
        { id: '1', title: 'Idea 1', status: 'SUBMITTED' },
        { id: '2', title: 'Idea 2', status: 'APPROVED' },
      ];

      vi.mocked(client.get).mockResolvedValue({ data: mockIdeas });

      const result = await ideasApi.getAll();

      expect(result).toEqual(mockIdeas);
      expect(client.get).toHaveBeenCalledWith('/ideas?');
    });

    it('should fetch ideas with status filter', async () => {
      const mockIdeas = [{ id: '1', title: 'Idea 1', status: 'APPROVED' }];

      vi.mocked(client.get).mockResolvedValue({ data: mockIdeas });

      await ideasApi.getAll({ status: 'APPROVED' });

      expect(client.get).toHaveBeenCalledWith('/ideas?status=APPROVED');
    });

    it('should fetch ideas with multiple filters', async () => {
      vi.mocked(client.get).mockResolvedValue({ data: [] });

      await ideasApi.getAll({
        status: 'SUBMITTED',
        submitterId: 'user123',
        tags: ['automation', 'testing'],
      });

      const call = vi.mocked(client.get).mock.calls[0][0];
      expect(call).toContain('status=SUBMITTED');
      expect(call).toContain('submitterId=user123');
      expect(call).toContain('tags=automation');
      expect(call).toContain('tags=testing');
    });
  });

  describe('getOne', () => {
    it('should fetch a single idea by id', async () => {
      const mockIdea = { id: '1', title: 'Test Idea', status: 'SUBMITTED' };

      vi.mocked(client.get).mockResolvedValue({ data: mockIdea });

      const result = await ideasApi.getOne('1');

      expect(result).toEqual(mockIdea);
      expect(client.get).toHaveBeenCalledWith('/ideas/1');
    });
  });

  describe('create', () => {
    it('should create a new idea', async () => {
      const newIdea = {
        title: 'New Idea',
        description: 'Description',
        effort: 'ONE_TO_THREE_DAYS' as const,
        tags: ['test'],
      };

      const createdIdea = { id: '1', ...newIdea, status: 'SUBMITTED' };

      vi.mocked(client.post).mockResolvedValue({ data: createdIdea });

      const result = await ideasApi.create(newIdea);

      expect(result).toEqual(createdIdea);
      expect(client.post).toHaveBeenCalledWith('/ideas', newIdea);
    });
  });

  describe('update', () => {
    it('should update an existing idea', async () => {
      const updateData = {
        title: 'Updated Title',
        description: 'Updated Description',
      };

      const updatedIdea = { id: '1', ...updateData, status: 'SUBMITTED' };

      vi.mocked(client.patch).mockResolvedValue({ data: updatedIdea });

      const result = await ideasApi.update('1', updateData);

      expect(result).toEqual(updatedIdea);
      expect(client.patch).toHaveBeenCalledWith('/ideas/1', updateData);
    });
  });

  describe('approve', () => {
    it('should approve an idea without data', async () => {
      const approvedIdea = { id: '1', status: 'APPROVED' };

      vi.mocked(client.patch).mockResolvedValue({ data: approvedIdea });

      const result = await ideasApi.approve('1');

      expect(result).toEqual(approvedIdea);
      expect(client.patch).toHaveBeenCalledWith('/ideas/1/approve', {});
    });

    it('should approve an idea with review data', async () => {
      const reviewData = { comment: 'Looks good!' };
      const approvedIdea = { id: '1', status: 'APPROVED' };

      vi.mocked(client.patch).mockResolvedValue({ data: approvedIdea });

      await ideasApi.approve('1', reviewData);

      expect(client.patch).toHaveBeenCalledWith('/ideas/1/approve', reviewData);
    });
  });

  describe('reject', () => {
    it('should reject an idea', async () => {
      const reviewData = { comment: 'Not feasible' };
      const rejectedIdea = { id: '1', status: 'REJECTED' };

      vi.mocked(client.patch).mockResolvedValue({ data: rejectedIdea });

      const result = await ideasApi.reject('1', reviewData);

      expect(result).toEqual(rejectedIdea);
      expect(client.patch).toHaveBeenCalledWith('/ideas/1/reject', reviewData);
    });
  });

  describe('claim', () => {
    it('should claim an idea', async () => {
      const claimedIdea = { id: '1', status: 'IN_PROGRESS' };

      vi.mocked(client.patch).mockResolvedValue({ data: claimedIdea });

      const result = await ideasApi.claim('1');

      expect(result).toEqual(claimedIdea);
      expect(client.patch).toHaveBeenCalledWith('/ideas/1/claim');
    });
  });

  describe('complete', () => {
    it('should complete an idea', async () => {
      const reviewData = { comment: 'Completed successfully' };
      const completedIdea = { id: '1', status: 'DONE' };

      vi.mocked(client.patch).mockResolvedValue({ data: completedIdea });

      const result = await ideasApi.complete('1', reviewData);

      expect(result).toEqual(completedIdea);
      expect(client.patch).toHaveBeenCalledWith('/ideas/1/complete', reviewData);
    });
  });

  describe('error handling', () => {
    it('should propagate errors from failed requests', async () => {
      const error = new Error('Network error');
      vi.mocked(client.get).mockRejectedValue(error);

      await expect(ideasApi.getAll()).rejects.toThrow('Network error');
    });
  });
});
