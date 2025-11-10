"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportsApi = void 0;
const client_1 = __importDefault(require("./client"));
exports.reportsApi = {
    getSummary: async () => {
        const response = await client_1.default.get('/api/reports/summary');
        return response.data;
    },
    getMonthlyTrend: async () => {
        const response = await client_1.default.get('/api/reports/monthly-trend');
        return response.data;
    },
    getTopContributors: async (limit = 10) => {
        const response = await client_1.default.get(`/api/reports/top-contributors?limit=${limit}`);
        return response.data;
    },
    getFiltered: async (filters) => {
        const params = new URLSearchParams();
        if (filters?.status)
            params.append('status', filters.status);
        if (filters?.startDate)
            params.append('startDate', filters.startDate);
        if (filters?.endDate)
            params.append('endDate', filters.endDate);
        if (filters?.submitterId)
            params.append('submitterId', filters.submitterId);
        if (filters?.assigneeId)
            params.append('assigneeId', filters.assigneeId);
        if (filters?.tags)
            filters.tags.forEach((tag) => params.append('tags', tag));
        const response = await client_1.default.get(`/api/reports/filtered?${params.toString()}`);
        return response.data;
    },
    exportCSV: async (filters) => {
        const params = new URLSearchParams();
        params.append('format', 'csv');
        if (filters?.status)
            params.append('status', filters.status);
        if (filters?.startDate)
            params.append('startDate', filters.startDate);
        if (filters?.endDate)
            params.append('endDate', filters.endDate);
        if (filters?.submitterId)
            params.append('submitterId', filters.submitterId);
        if (filters?.assigneeId)
            params.append('assigneeId', filters.assigneeId);
        if (filters?.tags)
            filters.tags.forEach((tag) => params.append('tags', tag));
        const response = await client_1.default.get(`/api/reports/filtered?${params.toString()}`, {
            responseType: 'blob',
        });
        return response.data;
    },
};
//# sourceMappingURL=reports.js.map