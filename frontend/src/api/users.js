"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.usersApi = void 0;
const client_1 = __importDefault(require("./client"));
exports.usersApi = {
    getAll: async () => {
        const response = await client_1.default.get('/api/users');
        return response.data;
    },
    getOne: async (id) => {
        const response = await client_1.default.get(`/api/users/${id}`);
        return response.data;
    },
    create: async (data) => {
        const response = await client_1.default.post('/api/users', data);
        return response.data;
    },
    update: async (id, data) => {
        const response = await client_1.default.patch(`/api/users/${id}`, data);
        return response.data;
    },
    delete: async (id) => {
        await client_1.default.delete(`/api/users/${id}`);
    },
};
//# sourceMappingURL=users.js.map