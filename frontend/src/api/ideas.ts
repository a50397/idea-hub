import client from './client';
import type { Idea, IdeaStep, CreateIdeaInput, UpdateIdeaInput, ReviewIdeaInput, IdeaStatus } from '../types';

export const ideasApi = {
  getAll: async (filters?: {
    status?: IdeaStatus;
    submitterId?: string;
    assigneeId?: string;
    tags?: string[];
  }): Promise<Idea[]> => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.submitterId) params.append('submitterId', filters.submitterId);
    if (filters?.assigneeId) params.append('assigneeId', filters.assigneeId);
    if (filters?.tags) filters.tags.forEach((tag) => params.append('tags', tag));

    const response = await client.get(`/ideas?${params.toString()}`);
    return response.data.data;
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

  addStep: async (ideaId: string, data: { text: string }): Promise<IdeaStep> => {
    const response = await client.post(`/ideas/${ideaId}/steps`, data);
    return response.data;
  },
};
