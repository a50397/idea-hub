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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vue_1 = require("vue");
const vue_router_1 = require("vue-router");
const ideas_1 = require("../api/ideas");
const types_1 = require("../types");
const IdeaCard_vue_1 = __importDefault(require("../components/IdeaCard.vue"));
const router = (0, vue_router_1.useRouter)();
const loading = (0, vue_1.ref)(true);
const ideas = (0, vue_1.ref)([]);
const claimingId = (0, vue_1.ref)(null);
const snackbar = (0, vue_1.ref)(false);
const snackbarText = (0, vue_1.ref)('');
const snackbarColor = (0, vue_1.ref)('success');
async function loadIdeas() {
    loading.value = true;
    try {
        ideas.value = await ideas_1.ideasApi.getAll({ status: types_1.IdeaStatus.APPROVED });
    }
    catch (error) {
        console.error('Error loading ideas:', error);
    }
    finally {
        loading.value = false;
    }
}
function viewIdea(id) {
    router.push({ name: 'IdeaDetail', params: { id } });
}
async function claimIdea(id) {
    claimingId.value = id;
    try {
        await ideas_1.ideasApi.claim(id);
        snackbarText.value = 'Idea claimed successfully! Good luck!';
        snackbarColor.value = 'success';
        snackbar.value = true;
        await loadIdeas();
    }
    catch (error) {
        snackbarText.value = error.response?.data?.error || 'Failed to claim idea';
        snackbarColor.value = 'error';
        snackbar.value = true;
    }
    finally {
        claimingId.value = null;
    }
}
(0, vue_1.onMounted)(() => {
    loadIdeas();
});
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
const __VLS_0 = {}.VContainer;
/** @type {[typeof __VLS_components.VContainer, typeof __VLS_components.vContainer, typeof __VLS_components.VContainer, typeof __VLS_components.vContainer, ]} */ ;
// @ts-ignore
const __VLS_1 = __VLS_asFunctionalComponent(__VLS_0, new __VLS_0({
    fluid: true,
    ...{ class: "page-container" },
}));
const __VLS_2 = __VLS_1({
    fluid: true,
    ...{ class: "page-container" },
}, ...__VLS_functionalComponentArgsRest(__VLS_1));
var __VLS_4 = {};
__VLS_3.slots.default;
__VLS_asFunctionalElement(__VLS_intrinsicElements.h1, __VLS_intrinsicElements.h1)({
    ...{ class: "text-h4 page-title" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
    ...{ class: "text-subtitle-1 mb-4" },
});
if (__VLS_ctx.loading) {
    const __VLS_5 = {}.VRow;
    /** @type {[typeof __VLS_components.VRow, typeof __VLS_components.vRow, typeof __VLS_components.VRow, typeof __VLS_components.vRow, ]} */ ;
    // @ts-ignore
    const __VLS_6 = __VLS_asFunctionalComponent(__VLS_5, new __VLS_5({}));
    const __VLS_7 = __VLS_6({}, ...__VLS_functionalComponentArgsRest(__VLS_6));
    __VLS_8.slots.default;
    const __VLS_9 = {}.VCol;
    /** @type {[typeof __VLS_components.VCol, typeof __VLS_components.vCol, typeof __VLS_components.VCol, typeof __VLS_components.vCol, ]} */ ;
    // @ts-ignore
    const __VLS_10 = __VLS_asFunctionalComponent(__VLS_9, new __VLS_9({
        cols: "12",
        ...{ class: "text-center" },
    }));
    const __VLS_11 = __VLS_10({
        cols: "12",
        ...{ class: "text-center" },
    }, ...__VLS_functionalComponentArgsRest(__VLS_10));
    __VLS_12.slots.default;
    const __VLS_13 = {}.VProgressCircular;
    /** @type {[typeof __VLS_components.VProgressCircular, typeof __VLS_components.vProgressCircular, typeof __VLS_components.VProgressCircular, typeof __VLS_components.vProgressCircular, ]} */ ;
    // @ts-ignore
    const __VLS_14 = __VLS_asFunctionalComponent(__VLS_13, new __VLS_13({
        indeterminate: true,
        color: "primary",
    }));
    const __VLS_15 = __VLS_14({
        indeterminate: true,
        color: "primary",
    }, ...__VLS_functionalComponentArgsRest(__VLS_14));
    var __VLS_12;
    var __VLS_8;
}
else {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
    if (__VLS_ctx.ideas.length) {
        const __VLS_17 = {}.VRow;
        /** @type {[typeof __VLS_components.VRow, typeof __VLS_components.vRow, typeof __VLS_components.VRow, typeof __VLS_components.vRow, ]} */ ;
        // @ts-ignore
        const __VLS_18 = __VLS_asFunctionalComponent(__VLS_17, new __VLS_17({}));
        const __VLS_19 = __VLS_18({}, ...__VLS_functionalComponentArgsRest(__VLS_18));
        __VLS_20.slots.default;
        for (const [idea] of __VLS_getVForSourceType((__VLS_ctx.ideas))) {
            const __VLS_21 = {}.VCol;
            /** @type {[typeof __VLS_components.VCol, typeof __VLS_components.vCol, typeof __VLS_components.VCol, typeof __VLS_components.vCol, ]} */ ;
            // @ts-ignore
            const __VLS_22 = __VLS_asFunctionalComponent(__VLS_21, new __VLS_21({
                key: (idea.id),
                cols: "12",
                md: "6",
                lg: "4",
            }));
            const __VLS_23 = __VLS_22({
                key: (idea.id),
                cols: "12",
                md: "6",
                lg: "4",
            }, ...__VLS_functionalComponentArgsRest(__VLS_22));
            __VLS_24.slots.default;
            /** @type {[typeof IdeaCard, typeof IdeaCard, ]} */ ;
            // @ts-ignore
            const __VLS_25 = __VLS_asFunctionalComponent(IdeaCard_vue_1.default, new IdeaCard_vue_1.default({
                ...{ 'onView': {} },
                idea: (idea),
            }));
            const __VLS_26 = __VLS_25({
                ...{ 'onView': {} },
                idea: (idea),
            }, ...__VLS_functionalComponentArgsRest(__VLS_25));
            let __VLS_28;
            let __VLS_29;
            let __VLS_30;
            const __VLS_31 = {
                onView: (__VLS_ctx.viewIdea)
            };
            __VLS_27.slots.default;
            {
                const { actions: __VLS_thisSlot } = __VLS_27.slots;
                const __VLS_32 = {}.VBtn;
                /** @type {[typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, ]} */ ;
                // @ts-ignore
                const __VLS_33 = __VLS_asFunctionalComponent(__VLS_32, new __VLS_32({
                    ...{ 'onClick': {} },
                    color: "success",
                    variant: "elevated",
                    loading: (__VLS_ctx.claimingId === idea.id),
                }));
                const __VLS_34 = __VLS_33({
                    ...{ 'onClick': {} },
                    color: "success",
                    variant: "elevated",
                    loading: (__VLS_ctx.claimingId === idea.id),
                }, ...__VLS_functionalComponentArgsRest(__VLS_33));
                let __VLS_36;
                let __VLS_37;
                let __VLS_38;
                const __VLS_39 = {
                    onClick: (...[$event]) => {
                        if (!!(__VLS_ctx.loading))
                            return;
                        if (!(__VLS_ctx.ideas.length))
                            return;
                        __VLS_ctx.claimIdea(idea.id);
                    }
                };
                __VLS_35.slots.default;
                var __VLS_35;
            }
            var __VLS_27;
            var __VLS_24;
        }
        var __VLS_20;
    }
    else {
        const __VLS_40 = {}.VAlert;
        /** @type {[typeof __VLS_components.VAlert, typeof __VLS_components.vAlert, typeof __VLS_components.VAlert, typeof __VLS_components.vAlert, ]} */ ;
        // @ts-ignore
        const __VLS_41 = __VLS_asFunctionalComponent(__VLS_40, new __VLS_40({
            type: "info",
        }));
        const __VLS_42 = __VLS_41({
            type: "info",
        }, ...__VLS_functionalComponentArgsRest(__VLS_41));
        __VLS_43.slots.default;
        var __VLS_43;
    }
}
const __VLS_44 = {}.VSnackbar;
/** @type {[typeof __VLS_components.VSnackbar, typeof __VLS_components.vSnackbar, typeof __VLS_components.VSnackbar, typeof __VLS_components.vSnackbar, ]} */ ;
// @ts-ignore
const __VLS_45 = __VLS_asFunctionalComponent(__VLS_44, new __VLS_44({
    modelValue: (__VLS_ctx.snackbar),
    color: (__VLS_ctx.snackbarColor),
}));
const __VLS_46 = __VLS_45({
    modelValue: (__VLS_ctx.snackbar),
    color: (__VLS_ctx.snackbarColor),
}, ...__VLS_functionalComponentArgsRest(__VLS_45));
__VLS_47.slots.default;
(__VLS_ctx.snackbarText);
var __VLS_47;
var __VLS_3;
/** @type {__VLS_StyleScopedClasses['page-container']} */ ;
/** @type {__VLS_StyleScopedClasses['text-h4']} */ ;
/** @type {__VLS_StyleScopedClasses['page-title']} */ ;
/** @type {__VLS_StyleScopedClasses['text-subtitle-1']} */ ;
/** @type {__VLS_StyleScopedClasses['mb-4']} */ ;
/** @type {__VLS_StyleScopedClasses['text-center']} */ ;
var __VLS_dollars;
const __VLS_self = (await Promise.resolve().then(() => __importStar(require('vue')))).defineComponent({
    setup() {
        return {
            IdeaCard: IdeaCard_vue_1.default,
            loading: loading,
            ideas: ideas,
            claimingId: claimingId,
            snackbar: snackbar,
            snackbarText: snackbarText,
            snackbarColor: snackbarColor,
            viewIdea: viewIdea,
            claimIdea: claimIdea,
        };
    },
});
exports.default = (await Promise.resolve().then(() => __importStar(require('vue')))).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
//# sourceMappingURL=ApprovedIdeasPage.vue.js.map