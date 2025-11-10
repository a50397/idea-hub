"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vue_1 = require("vue");
const pinia_1 = require("pinia");
const App_vue_1 = __importDefault(require("./App.vue"));
const router_1 = __importDefault(require("./router"));
const vuetify_1 = __importDefault(require("./plugins/vuetify"));
require("./styles/main.css");
const app = (0, vue_1.createApp)(App_vue_1.default);
const pinia = (0, pinia_1.createPinia)();
app.use(pinia);
app.use(router_1.default);
app.use(vuetify_1.default);
app.mount('#app');
//# sourceMappingURL=main.js.map