"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authApi = void 0;
const client_1 = __importDefault(require("./client"));
exports.authApi = {
    login: async (email, password) => {
        const response = await client_1.default.post('/api/auth/login', { email, password });
        return response.data;
    },
    logout: async () => {
        await client_1.default.post('/api/auth/logout');
    },
    getCurrentUser: async () => {
        const response = await client_1.default.get('/api/auth/me');
        return response.data;
    },
};
//# sourceMappingURL=auth.js.map