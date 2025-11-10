"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ideasApi = void 0;
const client_1 = __importDefault(require("./client"));
exports.ideasApi = {
    getAll: async (filters) => {
        const params = new URLSearchParams();
        if (filters?.status)
            params.append('status', filters.status);
        if (filters?.submitterId)
            params.append('submitterId', filters.submitterId);
        if (filters?.assigneeId)
            params.append('assigneeId', filters.assigneeId);
        if (filters?.tags)
            filters.tags.forEach((tag) => params.append('tags', tag));
        const response = await client_1.default.get(`/api/ideas?${params.toString()}`);
        return response.data;
    },
    getOne: async (id) => {
        const response = await client_1.default.get(`/api/ideas/${id}`);
        return response.data;
    },
    create: async (data) => {
        const response = await client_1.default.post('/api/ideas', data);
        return response.data;
    },
    update: async (id, data) => {
        const response = await client_1.default.patch(`/api/ideas/${id}`, data);
        return response.data;
    },
    approve: async (id, data) => {
        const response = await client_1.default.patch(`/api/ideas/${id}/approve`, data || {});
        return response.data;
    },
    reject: async (id, data) => {
        const response = await client_1.default.patch(`/api/ideas/${id}/reject`, data || {});
        return response.data;
    },
    claim: async (id) => {
        const response = await client_1.default.patch(`/api/ideas/${id}/claim`);
        return response.data;
    },
    complete: async (id, data) => {
        const response = await client_1.default.patch(`/api/ideas/${id}/complete`, data || {});
        return response.data;
    },
};
//# sourceMappingURL=ideas.js.map