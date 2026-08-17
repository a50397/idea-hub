import client from './client';
import { MAX_PAGE_LIMIT } from '../types';
import type {
  DashboardSummary,
  MonthlyTrend,
  TopContributor,
  DepartmentReport,
  Idea,
  IdeaStatus,
  Paginated,
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

  // Returns the whole paginated envelope: `pagination.total` is the full match
  // count, which the page needs to warn that the table (and the CSV export,
  // capped at MAX_PAGE_LIMIT) shows only the first page.
  getFiltered: async (filters?: {
    status?: IdeaStatus;
    startDate?: string;
    endDate?: string;
    submitterId?: string;
    assigneeId?: string;
    departmentId?: string;
    tags?: string[];
    page?: number;
    limit?: number;
  }): Promise<Paginated<Idea>> => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    if (filters?.submitterId) params.append('submitterId', filters.submitterId);
    if (filters?.assigneeId) params.append('assigneeId', filters.assigneeId);
    if (filters?.departmentId) params.append('departmentId', filters.departmentId);
    if (filters?.tags) filters.tags.forEach((tag) => params.append('tags', tag));
    if (filters?.page) params.append('page', String(filters.page));
    if (filters?.limit) params.append('limit', String(filters.limit));

    const response = await client.get(`/reports/filtered?${params.toString()}`);
    return { data: response.data.data, pagination: response.data.pagination };
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
    // The server caps `limit` at 100 (backend/src/utils/validation.ts); ask for
    // the maximum so the export is not silently cut to the default page of 20.
    params.append('limit', String(MAX_PAGE_LIMIT));
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
