import client from './client';
import type {
  DashboardSummary,
  MonthlyTrend,
  TopContributor,
  DepartmentReport,
  Idea,
  IdeaStatus,
} from '../types';

export const reportsApi = {
  getSummary: async (): Promise<DashboardSummary> => {
    const response = await client.get('/reports/summary');
    return response.data;
  },

  getMonthlyTrend: async (): Promise<MonthlyTrend[]> => {
    const response = await client.get('/reports/monthly-trend');
    return response.data;
  },

  getTopContributors: async (limit = 10): Promise<TopContributor[]> => {
    const response = await client.get(`/reports/top-contributors?limit=${limit}`);
    return response.data;
  },

  getByDepartment: async (): Promise<DepartmentReport[]> => {
    const response = await client.get('/reports/by-department');
    return response.data;
  },

  getFiltered: async (filters?: {
    status?: IdeaStatus;
    startDate?: string;
    endDate?: string;
    submitterId?: string;
    assigneeId?: string;
    departmentId?: string;
    tags?: string[];
  }): Promise<Idea[]> => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    if (filters?.submitterId) params.append('submitterId', filters.submitterId);
    if (filters?.assigneeId) params.append('assigneeId', filters.assigneeId);
    if (filters?.departmentId) params.append('departmentId', filters.departmentId);
    if (filters?.tags) filters.tags.forEach((tag) => params.append('tags', tag));

    const response = await client.get(`/reports/filtered?${params.toString()}`);
    return response.data.data ?? response.data;
  },

  exportCSV: async (filters?: {
    status?: IdeaStatus;
    startDate?: string;
    endDate?: string;
    submitterId?: string;
    assigneeId?: string;
    departmentId?: string;
    tags?: string[];
  }): Promise<Blob> => {
    const params = new URLSearchParams();
    params.append('format', 'csv');
    if (filters?.status) params.append('status', filters.status);
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    if (filters?.submitterId) params.append('submitterId', filters.submitterId);
    if (filters?.assigneeId) params.append('assigneeId', filters.assigneeId);
    if (filters?.departmentId) params.append('departmentId', filters.departmentId);
    if (filters?.tags) filters.tags.forEach((tag) => params.append('tags', tag));

    const response = await client.get(`/reports/filtered?${params.toString()}`, {
      responseType: 'blob',
    });
    return response.data;
  },
};
