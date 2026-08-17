import client from './client';
import type { Idea, IdeaStep, CreateIdeaInput, UpdateIdeaInput, ReviewIdeaInput, IdeaStatus, Paginated } from '../types';

export const ideasApi = {
  // Returns the whole paginated envelope: callers need `pagination.total` to
  // tell the user when the server capped the page (backend limit max is 100).
  getAll: async (filters?: {
    status?: IdeaStatus;
    submitterId?: string;
    assigneeId?: string;
    departmentId?: string;
    tags?: string[];
    page?: number;
    limit?: number;
  }): Promise<Paginated<Idea>> => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.submitterId) params.append('submitterId', filters.submitterId);
    if (filters?.assigneeId) params.append('assigneeId', filters.assigneeId);
    if (filters?.departmentId) params.append('departmentId', filters.departmentId);
    if (filters?.tags) filters.tags.forEach((tag) => params.append('tags', tag));
    // Explicit undefined checks: numeric params must never be dropped by a
    // truthiness test (1-based pages mean 0 is invalid, not "default").
    if (filters?.page !== undefined) params.append('page', String(filters.page));
    if (filters?.limit !== undefined) params.append('limit', String(filters.limit));

    const response = await client.get(`/ideas?${params.toString()}`);
    return { data: response.data.data, pagination: response.data.pagination };
  },

  getOne: async (id: string): Promise<Idea> => {
    const response = await client.get(`/ideas/${id}`);
    return response.data;
  },

  create: async (data: CreateIdeaInput): Promise<Idea> => {
    const response = await client.post('/ideas', data);
    return response.data;
  },

  update: async (id: string, data: UpdateIdeaInput): Promise<Idea> => {
    const response = await client.patch(`/ideas/${id}`, data);
    return response.data;
  },

  approve: async (id: string, data?: ReviewIdeaInput): Promise<Idea> => {
    const response = await client.patch(`/ideas/${id}/approve`, data || {});
    return response.data;
  },

  reject: async (id: string, data?: ReviewIdeaInput): Promise<Idea> => {
    const response = await client.patch(`/ideas/${id}/reject`, data || {});
    return response.data;
  },

  claim: async (id: string): Promise<Idea> => {
    const response = await client.patch(`/ideas/${id}/claim`);
    return response.data;
  },

  complete: async (id: string, data?: ReviewIdeaInput): Promise<Idea> => {
    const response = await client.patch(`/ideas/${id}/complete`, data || {});
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await client.delete(`/ideas/${id}`);
  },

  addStep: async (ideaId: string, data: { text: string }): Promise<IdeaStep> => {
    const response = await client.post(`/ideas/${ideaId}/steps`, data);
    return response.data;
  },

  // Toggle the submitter's opt-in to lifecycle notification emails. Submitter-only
  // on the backend; allowed in any status. Returns the updated idea.
  setNotify: async (id: string, enabled: boolean): Promise<Idea> => {
    const response = await client.patch(`/ideas/${id}/notify`, { enabled });
    return response.data;
  },
};
