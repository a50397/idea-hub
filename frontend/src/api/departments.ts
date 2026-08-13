import client from './client';
import type { Department } from '../types';

export const departmentsApi = {
  getAll: async (): Promise<Department[]> => {
    const response = await client.get('/departments');
    return response.data;
  },

  create: async (name: string): Promise<Department> => {
    const response = await client.post('/departments', { name });
    return response.data;
  },

  // Update a department's name and/or notification emails and/or Webex room ids
  // and/or its Jira project-key override. Every field is optional, so a
  // rename-only (or emails-only, or rooms-only, or jira-key-only) update sends just
  // that key; an explicit [] clears a list and an explicit '' clears the Jira
  // project key (falls back to the installation-wide default).
  update: async (
    id: string,
    payload: {
      name?: string;
      notificationEmails?: string[];
      webexRoomIds?: string[];
      jiraProjectKey?: string;
    }
  ): Promise<Department> => {
    const response = await client.patch(`/departments/${id}`, payload);
    return response.data;
  },

  // ids must be an exact permutation of every current department id; the server
  // returns the full, reordered list (including _count).
  reorder: async (ids: string[]): Promise<Department[]> => {
    const response = await client.patch('/departments/reorder', { ids });
    return response.data;
  },

  remove: async (id: string): Promise<{ message: string }> => {
    const response = await client.delete(`/departments/${id}`);
    return response.data;
  },
};
