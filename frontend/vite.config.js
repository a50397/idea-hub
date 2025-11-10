"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vite_1 = require("vite");
const plugin_vue_1 = __importDefault(require("@vitejs/plugin-vue"));
const vite_plugin_vuetify_1 = __importDefault(require("vite-plugin-vuetify"));
const node_url_1 = require("node:url");
exports.default = (0, vite_1.defineConfig)({
    plugins: [
        (0, plugin_vue_1.default)(),
        (0, vite_plugin_vuetify_1.default)({ autoImport: true }),
    ],
    resolve: {
        alias: {
            '@': (0, node_url_1.fileURLToPath)(new node_url_1.URL('./src', import.meta.url)),
        },
    },
    server: {
        port: 5173,
        proxy: {
            '/api': {
                target: process.env.VITE_API_URL || 'http://localhost:3001',
                changeOrigin: true,
            },
        },
    },
});
//# sourceMappingURL=vite.config.js.map