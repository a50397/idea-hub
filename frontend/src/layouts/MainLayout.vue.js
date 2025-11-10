"use strict";
/// <reference types="../../../node_modules/.vue-global-types/vue_3.5_0_0_0.d.ts" />
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
const vue_1 = require("vue");
const vue_router_1 = require("vue-router");
const auth_1 = require("../stores/auth");
const drawer = (0, vue_1.ref)(true);
const router = (0, vue_router_1.useRouter)();
const authStore = (0, auth_1.useAuthStore)();
async function handleLogout() {
    await authStore.logout();
    router.push({ name: 'Login' });
}
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
const __VLS_0 = {}.VApp;
/** @type {[typeof __VLS_components.VApp, typeof __VLS_components.vApp, typeof __VLS_components.VApp, typeof __VLS_components.vApp, ]} */ ;
// @ts-ignore
const __VLS_1 = __VLS_asFunctionalComponent(__VLS_0, new __VLS_0({}));
const __VLS_2 = __VLS_1({}, ...__VLS_functionalComponentArgsRest(__VLS_1));
var __VLS_4 = {};
__VLS_3.slots.default;
const __VLS_5 = {}.VNavigationDrawer;
/** @type {[typeof __VLS_components.VNavigationDrawer, typeof __VLS_components.vNavigationDrawer, typeof __VLS_components.VNavigationDrawer, typeof __VLS_components.vNavigationDrawer, ]} */ ;
// @ts-ignore
const __VLS_6 = __VLS_asFunctionalComponent(__VLS_5, new __VLS_5({
    modelValue: (__VLS_ctx.drawer),
    app: true,
}));
const __VLS_7 = __VLS_6({
    modelValue: (__VLS_ctx.drawer),
    app: true,
}, ...__VLS_functionalComponentArgsRest(__VLS_6));
__VLS_8.slots.default;
const __VLS_9 = {}.VList;
/** @type {[typeof __VLS_components.VList, typeof __VLS_components.vList, typeof __VLS_components.VList, typeof __VLS_components.vList, ]} */ ;
// @ts-ignore
const __VLS_10 = __VLS_asFunctionalComponent(__VLS_9, new __VLS_9({}));
const __VLS_11 = __VLS_10({}, ...__VLS_functionalComponentArgsRest(__VLS_10));
__VLS_12.slots.default;
const __VLS_13 = {}.VListItem;
/** @type {[typeof __VLS_components.VListItem, typeof __VLS_components.vListItem, typeof __VLS_components.VListItem, typeof __VLS_components.vListItem, ]} */ ;
// @ts-ignore
const __VLS_14 = __VLS_asFunctionalComponent(__VLS_13, new __VLS_13({
    prependAvatar: (`https://ui-avatars.com/api/?name=${__VLS_ctx.authStore.user?.name}&background=1976D2&color=fff`),
    title: (__VLS_ctx.authStore.user?.name),
    subtitle: (__VLS_ctx.authStore.user?.email),
}));
const __VLS_15 = __VLS_14({
    prependAvatar: (`https://ui-avatars.com/api/?name=${__VLS_ctx.authStore.user?.name}&background=1976D2&color=fff`),
    title: (__VLS_ctx.authStore.user?.name),
    subtitle: (__VLS_ctx.authStore.user?.email),
}, ...__VLS_functionalComponentArgsRest(__VLS_14));
var __VLS_12;
const __VLS_17 = {}.VDivider;
/** @type {[typeof __VLS_components.VDivider, typeof __VLS_components.vDivider, typeof __VLS_components.VDivider, typeof __VLS_components.vDivider, ]} */ ;
// @ts-ignore
const __VLS_18 = __VLS_asFunctionalComponent(__VLS_17, new __VLS_17({}));
const __VLS_19 = __VLS_18({}, ...__VLS_functionalComponentArgsRest(__VLS_18));
const __VLS_21 = {}.VList;
/** @type {[typeof __VLS_components.VList, typeof __VLS_components.vList, typeof __VLS_components.VList, typeof __VLS_components.vList, ]} */ ;
// @ts-ignore
const __VLS_22 = __VLS_asFunctionalComponent(__VLS_21, new __VLS_21({
    density: "compact",
    nav: true,
}));
const __VLS_23 = __VLS_22({
    density: "compact",
    nav: true,
}, ...__VLS_functionalComponentArgsRest(__VLS_22));
__VLS_24.slots.default;
const __VLS_25 = {}.VListItem;
/** @type {[typeof __VLS_components.VListItem, typeof __VLS_components.vListItem, typeof __VLS_components.VListItem, typeof __VLS_components.vListItem, ]} */ ;
// @ts-ignore
const __VLS_26 = __VLS_asFunctionalComponent(__VLS_25, new __VLS_25({
    prependIcon: "mdi-view-dashboard",
    title: "Dashboard",
    to: ({ name: 'Dashboard' }),
    exact: true,
}));
const __VLS_27 = __VLS_26({
    prependIcon: "mdi-view-dashboard",
    title: "Dashboard",
    to: ({ name: 'Dashboard' }),
    exact: true,
}, ...__VLS_functionalComponentArgsRest(__VLS_26));
const __VLS_29 = {}.VListItem;
/** @type {[typeof __VLS_components.VListItem, typeof __VLS_components.vListItem, typeof __VLS_components.VListItem, typeof __VLS_components.vListItem, ]} */ ;
// @ts-ignore
const __VLS_30 = __VLS_asFunctionalComponent(__VLS_29, new __VLS_29({
    prependIcon: "mdi-lightbulb-on",
    title: "Submit Idea",
    to: ({ name: 'SubmitIdea' }),
}));
const __VLS_31 = __VLS_30({
    prependIcon: "mdi-lightbulb-on",
    title: "Submit Idea",
    to: ({ name: 'SubmitIdea' }),
}, ...__VLS_functionalComponentArgsRest(__VLS_30));
const __VLS_33 = {}.VListItem;
/** @type {[typeof __VLS_components.VListItem, typeof __VLS_components.vListItem, typeof __VLS_components.VListItem, typeof __VLS_components.vListItem, ]} */ ;
// @ts-ignore
const __VLS_34 = __VLS_asFunctionalComponent(__VLS_33, new __VLS_33({
    prependIcon: "mdi-check-circle",
    title: "Approved",
    to: ({ name: 'ApprovedIdeas' }),
}));
const __VLS_35 = __VLS_34({
    prependIcon: "mdi-check-circle",
    title: "Approved",
    to: ({ name: 'ApprovedIdeas' }),
}, ...__VLS_functionalComponentArgsRest(__VLS_34));
const __VLS_37 = {}.VListItem;
/** @type {[typeof __VLS_components.VListItem, typeof __VLS_components.vListItem, typeof __VLS_components.VListItem, typeof __VLS_components.vListItem, ]} */ ;
// @ts-ignore
const __VLS_38 = __VLS_asFunctionalComponent(__VLS_37, new __VLS_37({
    prependIcon: "mdi-progress-clock",
    title: "In Progress",
    to: ({ name: 'InProgressIdeas' }),
}));
const __VLS_39 = __VLS_38({
    prependIcon: "mdi-progress-clock",
    title: "In Progress",
    to: ({ name: 'InProgressIdeas' }),
}, ...__VLS_functionalComponentArgsRest(__VLS_38));
const __VLS_41 = {}.VListItem;
/** @type {[typeof __VLS_components.VListItem, typeof __VLS_components.vListItem, typeof __VLS_components.VListItem, typeof __VLS_components.vListItem, ]} */ ;
// @ts-ignore
const __VLS_42 = __VLS_asFunctionalComponent(__VLS_41, new __VLS_41({
    prependIcon: "mdi-check-all",
    title: "Completed",
    to: ({ name: 'CompletedIdeas' }),
}));
const __VLS_43 = __VLS_42({
    prependIcon: "mdi-check-all",
    title: "Completed",
    to: ({ name: 'CompletedIdeas' }),
}, ...__VLS_functionalComponentArgsRest(__VLS_42));
if (__VLS_ctx.authStore.isPowerUser) {
    const __VLS_45 = {}.VListItem;
    /** @type {[typeof __VLS_components.VListItem, typeof __VLS_components.vListItem, typeof __VLS_components.VListItem, typeof __VLS_components.vListItem, ]} */ ;
    // @ts-ignore
    const __VLS_46 = __VLS_asFunctionalComponent(__VLS_45, new __VLS_45({
        prependIcon: "mdi-clipboard-check",
        title: "Review Queue",
        to: ({ name: 'ReviewQueue' }),
    }));
    const __VLS_47 = __VLS_46({
        prependIcon: "mdi-clipboard-check",
        title: "Review Queue",
        to: ({ name: 'ReviewQueue' }),
    }, ...__VLS_functionalComponentArgsRest(__VLS_46));
}
const __VLS_49 = {}.VListItem;
/** @type {[typeof __VLS_components.VListItem, typeof __VLS_components.vListItem, typeof __VLS_components.VListItem, typeof __VLS_components.vListItem, ]} */ ;
// @ts-ignore
const __VLS_50 = __VLS_asFunctionalComponent(__VLS_49, new __VLS_49({
    prependIcon: "mdi-chart-bar",
    title: "Reports",
    to: ({ name: 'Reports' }),
}));
const __VLS_51 = __VLS_50({
    prependIcon: "mdi-chart-bar",
    title: "Reports",
    to: ({ name: 'Reports' }),
}, ...__VLS_functionalComponentArgsRest(__VLS_50));
if (__VLS_ctx.authStore.isAdmin) {
    const __VLS_53 = {}.VListItem;
    /** @type {[typeof __VLS_components.VListItem, typeof __VLS_components.vListItem, typeof __VLS_components.VListItem, typeof __VLS_components.vListItem, ]} */ ;
    // @ts-ignore
    const __VLS_54 = __VLS_asFunctionalComponent(__VLS_53, new __VLS_53({
        prependIcon: "mdi-account-group",
        title: "Users",
        to: ({ name: 'Users' }),
    }));
    const __VLS_55 = __VLS_54({
        prependIcon: "mdi-account-group",
        title: "Users",
        to: ({ name: 'Users' }),
    }, ...__VLS_functionalComponentArgsRest(__VLS_54));
}
var __VLS_24;
{
    const { append: __VLS_thisSlot } = __VLS_8.slots;
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "pa-2" },
    });
    const __VLS_57 = {}.VBtn;
    /** @type {[typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, ]} */ ;
    // @ts-ignore
    const __VLS_58 = __VLS_asFunctionalComponent(__VLS_57, new __VLS_57({
        ...{ 'onClick': {} },
        block: true,
        prependIcon: "mdi-logout",
        variant: "outlined",
    }));
    const __VLS_59 = __VLS_58({
        ...{ 'onClick': {} },
        block: true,
        prependIcon: "mdi-logout",
        variant: "outlined",
    }, ...__VLS_functionalComponentArgsRest(__VLS_58));
    let __VLS_61;
    let __VLS_62;
    let __VLS_63;
    const __VLS_64 = {
        onClick: (__VLS_ctx.handleLogout)
    };
    __VLS_60.slots.default;
    var __VLS_60;
}
var __VLS_8;
const __VLS_65 = {}.VAppBar;
/** @type {[typeof __VLS_components.VAppBar, typeof __VLS_components.vAppBar, typeof __VLS_components.VAppBar, typeof __VLS_components.vAppBar, ]} */ ;
// @ts-ignore
const __VLS_66 = __VLS_asFunctionalComponent(__VLS_65, new __VLS_65({
    app: true,
}));
const __VLS_67 = __VLS_66({
    app: true,
}, ...__VLS_functionalComponentArgsRest(__VLS_66));
__VLS_68.slots.default;
const __VLS_69 = {}.VAppBarNavIcon;
/** @type {[typeof __VLS_components.VAppBarNavIcon, typeof __VLS_components.vAppBarNavIcon, typeof __VLS_components.VAppBarNavIcon, typeof __VLS_components.vAppBarNavIcon, ]} */ ;
// @ts-ignore
const __VLS_70 = __VLS_asFunctionalComponent(__VLS_69, new __VLS_69({
    ...{ 'onClick': {} },
}));
const __VLS_71 = __VLS_70({
    ...{ 'onClick': {} },
}, ...__VLS_functionalComponentArgsRest(__VLS_70));
let __VLS_73;
let __VLS_74;
let __VLS_75;
const __VLS_76 = {
    onClick: (...[$event]) => {
        __VLS_ctx.drawer = !__VLS_ctx.drawer;
    }
};
var __VLS_72;
const __VLS_77 = {}.VToolbarTitle;
/** @type {[typeof __VLS_components.VToolbarTitle, typeof __VLS_components.vToolbarTitle, typeof __VLS_components.VToolbarTitle, typeof __VLS_components.vToolbarTitle, ]} */ ;
// @ts-ignore
const __VLS_78 = __VLS_asFunctionalComponent(__VLS_77, new __VLS_77({}));
const __VLS_79 = __VLS_78({}, ...__VLS_functionalComponentArgsRest(__VLS_78));
__VLS_80.slots.default;
var __VLS_80;
const __VLS_81 = {}.VSpacer;
/** @type {[typeof __VLS_components.VSpacer, typeof __VLS_components.vSpacer, typeof __VLS_components.VSpacer, typeof __VLS_components.vSpacer, ]} */ ;
// @ts-ignore
const __VLS_82 = __VLS_asFunctionalComponent(__VLS_81, new __VLS_81({}));
const __VLS_83 = __VLS_82({}, ...__VLS_functionalComponentArgsRest(__VLS_82));
const __VLS_85 = {}.VChip;
/** @type {[typeof __VLS_components.VChip, typeof __VLS_components.vChip, typeof __VLS_components.VChip, typeof __VLS_components.vChip, ]} */ ;
// @ts-ignore
const __VLS_86 = __VLS_asFunctionalComponent(__VLS_85, new __VLS_85({
    ...{ class: "ma-2" },
    color: "primary",
    label: true,
}));
const __VLS_87 = __VLS_86({
    ...{ class: "ma-2" },
    color: "primary",
    label: true,
}, ...__VLS_functionalComponentArgsRest(__VLS_86));
__VLS_88.slots.default;
(__VLS_ctx.authStore.user?.role);
var __VLS_88;
var __VLS_68;
const __VLS_89 = {}.VMain;
/** @type {[typeof __VLS_components.VMain, typeof __VLS_components.vMain, typeof __VLS_components.VMain, typeof __VLS_components.vMain, ]} */ ;
// @ts-ignore
const __VLS_90 = __VLS_asFunctionalComponent(__VLS_89, new __VLS_89({}));
const __VLS_91 = __VLS_90({}, ...__VLS_functionalComponentArgsRest(__VLS_90));
__VLS_92.slots.default;
const __VLS_93 = {}.RouterView;
/** @type {[typeof __VLS_components.RouterView, typeof __VLS_components.routerView, ]} */ ;
// @ts-ignore
const __VLS_94 = __VLS_asFunctionalComponent(__VLS_93, new __VLS_93({}));
const __VLS_95 = __VLS_94({}, ...__VLS_functionalComponentArgsRest(__VLS_94));
var __VLS_92;
var __VLS_3;
/** @type {__VLS_StyleScopedClasses['pa-2']} */ ;
/** @type {__VLS_StyleScopedClasses['ma-2']} */ ;
var __VLS_dollars;
const __VLS_self = (await Promise.resolve().then(() => __importStar(require('vue')))).defineComponent({
    setup() {
        return {
            drawer: drawer,
            authStore: authStore,
            handleLogout: handleLogout,
        };
    },
});
exports.default = (await Promise.resolve().then(() => __importStar(require('vue')))).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
//# sourceMappingURL=MainLayout.vue.js.map