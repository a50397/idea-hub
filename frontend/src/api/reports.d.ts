import type { DashboardSummary, MonthlyTrend, TopContributor, Idea, IdeaStatus } from '../types';
export declare const reportsApi: {
    getSummary: () => Promise<DashboardSummary>;
    getMonthlyTrend: () => Promise<MonthlyTrend[]>;
    getTopContributors: (limit?: number) => Promise<TopContributor[]>;
    getFiltered: (filters?: {
        status?: IdeaStatus;
        startDate?: string;
        endDate?: string;
        submitterId?: string;
        assigneeId?: string;
        tags?: string[];
    }) => Promise<Idea[]>;
    exportCSV: (filters?: {
        status?: IdeaStatus;
        startDate?: string;
        endDate?: string;
        submitterId?: string;
        assigneeId?: string;
        tags?: string[];
    }) => Promise<Blob>;
};
//# sourceMappingURL=reports.d.ts.map