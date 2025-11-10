"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const vue_router_1 = require("vue-router");
const auth_1 = require("../stores/auth");
const router = (0, vue_router_1.createRouter)({
    history: (0, vue_router_1.createWebHistory)(),
    routes: [
        {
            path: '/login',
            name: 'Login',
            component: () => Promise.resolve().then(() => __importStar(require('../pages/LoginPage.vue'))),
            meta: { requiresAuth: false },
        },
        {
            path: '/',
            component: () => Promise.resolve().then(() => __importStar(require('../layouts/MainLayout.vue'))),
            meta: { requiresAuth: true },
            children: [
                {
                    path: '',
                    name: 'Dashboard',
                    component: () => Promise.resolve().then(() => __importStar(require('../pages/DashboardPage.vue'))),
                },
                {
                    path: 'submit',
                    name: 'SubmitIdea',
                    component: () => Promise.resolve().then(() => __importStar(require('../pages/SubmitIdeaPage.vue'))),
                },
                {
                    path: 'ideas/:id',
                    name: 'IdeaDetail',
                    component: () => Promise.resolve().then(() => __importStar(require('../pages/IdeaDetailPage.vue'))),
                },
                {
                    path: 'approved',
                    name: 'ApprovedIdeas',
                    component: () => Promise.resolve().then(() => __importStar(require('../pages/ApprovedIdeasPage.vue'))),
                },
                {
                    path: 'in-progress',
                    name: 'InProgressIdeas',
                    component: () => Promise.resolve().then(() => __importStar(require('../pages/InProgressIdeasPage.vue'))),
                },
                {
                    path: 'completed',
                    name: 'CompletedIdeas',
                    component: () => Promise.resolve().then(() => __importStar(require('../pages/CompletedIdeasPage.vue'))),
                },
                {
                    path: 'review',
                    name: 'ReviewQueue',
                    component: () => Promise.resolve().then(() => __importStar(require('../pages/ReviewQueuePage.vue'))),
                    meta: { requiresPowerUser: true },
                },
                {
                    path: 'reports',
                    name: 'Reports',
                    component: () => Promise.resolve().then(() => __importStar(require('../pages/ReportsPage.vue'))),
                },
                {
                    path: 'users',
                    name: 'Users',
                    component: () => Promise.resolve().then(() => __importStar(require('../pages/UsersPage.vue'))),
                    meta: { requiresAdmin: true },
                },
            ],
        },
    ],
});
router.beforeEach(async (to, from, next) => {
    const authStore = (0, auth_1.useAuthStore)();
    if (to.meta.requiresAuth !== false) {
        if (!authStore.isAuthenticated) {
            await authStore.checkAuth();
        }
        if (!authStore.isAuthenticated) {
            return next({ name: 'Login' });
        }
        if (to.meta.requiresAdmin && !authStore.isAdmin) {
            return next({ name: 'Dashboard' });
        }
        if (to.meta.requiresPowerUser && !authStore.isPowerUser) {
            return next({ name: 'Dashboard' });
        }
    }
    if (to.name === 'Login' && authStore.isAuthenticated) {
        return next({ name: 'Dashboard' });
    }
    next();
});
exports.default = router;
//# sourceMappingURL=index.js.map