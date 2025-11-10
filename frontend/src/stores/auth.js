"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useAuthStore = void 0;
const pinia_1 = require("pinia");
const vue_1 = require("vue");
const auth_1 = require("../api/auth");
const types_1 = require("../types");
exports.useAuthStore = (0, pinia_1.defineStore)('auth', () => {
    const user = (0, vue_1.ref)(null);
    const loading = (0, vue_1.ref)(false);
    const error = (0, vue_1.ref)(null);
    const isAuthenticated = (0, vue_1.computed)(() => !!user.value);
    const isAdmin = (0, vue_1.computed)(() => user.value?.role === types_1.Role.ADMIN);
    const isPowerUser = (0, vue_1.computed)(() => user.value?.role === types_1.Role.POWER_USER || user.value?.role === types_1.Role.ADMIN);
    const isUser = (0, vue_1.computed)(() => !!user.value);
    async function login(email, password) {
        loading.value = true;
        error.value = null;
        try {
            const userData = await auth_1.authApi.login(email, password);
            user.value = userData;
            return true;
        }
        catch (err) {
            error.value = err.response?.data?.error || 'Login failed';
            return false;
        }
        finally {
            loading.value = false;
        }
    }
    async function logout() {
        loading.value = true;
        try {
            await auth_1.authApi.logout();
            user.value = null;
        }
        catch (err) {
            console.error('Logout error:', err);
        }
        finally {
            loading.value = false;
        }
    }
    async function checkAuth() {
        loading.value = true;
        try {
            const userData = await auth_1.authApi.getCurrentUser();
            user.value = userData;
            return true;
        }
        catch (err) {
            user.value = null;
            return false;
        }
        finally {
            loading.value = false;
        }
    }
    return {
        user,
        loading,
        error,
        isAuthenticated,
        isAdmin,
        isPowerUser,
        isUser,
        login,
        logout,
        checkAuth,
    };
});
//# sourceMappingURL=auth.js.map