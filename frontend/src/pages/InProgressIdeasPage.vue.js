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
const auth_1 = require("../stores/auth");
const ideas_1 = require("../api/ideas");
const types_1 = require("../types");
const IdeaCard_vue_1 = __importDefault(require("../components/IdeaCard.vue"));
const router = (0, vue_router_1.useRouter)();
const authStore = (0, auth_1.useAuthStore)();
const loading = (0, vue_1.ref)(true);
const ideas = (0, vue_1.ref)([]);
const completeDialog = (0, vue_1.ref)(false);
const completeNote = (0, vue_1.ref)('');
const completing = (0, vue_1.ref)(false);
const selectedIdea = (0, vue_1.ref)(null);
const snackbar = (0, vue_1.ref)(false);
const snackbarText = (0, vue_1.ref)('');
const snackbarColor = (0, vue_1.ref)('success');
async function loadIdeas() {
    loading.value = true;
    try {
        ideas.value = await ideas_1.ideasApi.getAll({ status: types_1.IdeaStatus.IN_PROGRESS });
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
function showCompleteDialog(idea) {
    selectedIdea.value = idea;
    completeNote.value = '';
    completeDialog.value = true;
}
async function completeIdea() {
    if (!selectedIdea.value)
        return;
    completing.value = true;
    try {
        await ideas_1.ideasApi.complete(selectedIdea.value.id, { note: completeNote.value });
        snackbarText.value = 'Idea marked as completed! Great work!';
        snackbarColor.value = 'success';
        snackbar.value = true;
        completeDialog.value = false;
        await loadIdeas();
    }
    catch (error) {
        snackbarText.value = error.response?.data?.error || 'Failed to complete idea';
        snackbarColor.value = 'error';
        snackbar.value = true;
    }
    finally {
        completing.value = false;
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
                if (idea.assigneeId === __VLS_ctx.authStore.user?.id) {
                    const __VLS_32 = {}.VBtn;
                    /** @type {[typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, ]} */ ;
                    // @ts-ignore
                    const __VLS_33 = __VLS_asFunctionalComponent(__VLS_32, new __VLS_32({
                        ...{ 'onClick': {} },
                        color: "primary",
                        variant: "elevated",
                    }));
                    const __VLS_34 = __VLS_33({
                        ...{ 'onClick': {} },
                        color: "primary",
                        variant: "elevated",
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
                            if (!(idea.assigneeId === __VLS_ctx.authStore.user?.id))
                                return;
                            __VLS_ctx.showCompleteDialog(idea);
                        }
                    };
                    __VLS_35.slots.default;
                    var __VLS_35;
                }
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
const __VLS_44 = {}.VDialog;
/** @type {[typeof __VLS_components.VDialog, typeof __VLS_components.vDialog, typeof __VLS_components.VDialog, typeof __VLS_components.vDialog, ]} */ ;
// @ts-ignore
const __VLS_45 = __VLS_asFunctionalComponent(__VLS_44, new __VLS_44({
    modelValue: (__VLS_ctx.completeDialog),
    maxWidth: "500",
}));
const __VLS_46 = __VLS_45({
    modelValue: (__VLS_ctx.completeDialog),
    maxWidth: "500",
}, ...__VLS_functionalComponentArgsRest(__VLS_45));
__VLS_47.slots.default;
const __VLS_48 = {}.VCard;
/** @type {[typeof __VLS_components.VCard, typeof __VLS_components.vCard, typeof __VLS_components.VCard, typeof __VLS_components.vCard, ]} */ ;
// @ts-ignore
const __VLS_49 = __VLS_asFunctionalComponent(__VLS_48, new __VLS_48({}));
const __VLS_50 = __VLS_49({}, ...__VLS_functionalComponentArgsRest(__VLS_49));
__VLS_51.slots.default;
const __VLS_52 = {}.VCardTitle;
/** @type {[typeof __VLS_components.VCardTitle, typeof __VLS_components.vCardTitle, typeof __VLS_components.VCardTitle, typeof __VLS_components.vCardTitle, ]} */ ;
// @ts-ignore
const __VLS_53 = __VLS_asFunctionalComponent(__VLS_52, new __VLS_52({}));
const __VLS_54 = __VLS_53({}, ...__VLS_functionalComponentArgsRest(__VLS_53));
__VLS_55.slots.default;
var __VLS_55;
const __VLS_56 = {}.VCardText;
/** @type {[typeof __VLS_components.VCardText, typeof __VLS_components.vCardText, typeof __VLS_components.VCardText, typeof __VLS_components.vCardText, ]} */ ;
// @ts-ignore
const __VLS_57 = __VLS_asFunctionalComponent(__VLS_56, new __VLS_56({}));
const __VLS_58 = __VLS_57({}, ...__VLS_functionalComponentArgsRest(__VLS_57));
__VLS_59.slots.default;
__VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
    ...{ class: "mb-4" },
});
const __VLS_60 = {}.VTextarea;
/** @type {[typeof __VLS_components.VTextarea, typeof __VLS_components.vTextarea, typeof __VLS_components.VTextarea, typeof __VLS_components.vTextarea, ]} */ ;
// @ts-ignore
const __VLS_61 = __VLS_asFunctionalComponent(__VLS_60, new __VLS_60({
    modelValue: (__VLS_ctx.completeNote),
    label: "Completion notes (optional)",
    variant: "outlined",
    rows: "3",
}));
const __VLS_62 = __VLS_61({
    modelValue: (__VLS_ctx.completeNote),
    label: "Completion notes (optional)",
    variant: "outlined",
    rows: "3",
}, ...__VLS_functionalComponentArgsRest(__VLS_61));
var __VLS_59;
const __VLS_64 = {}.VCardActions;
/** @type {[typeof __VLS_components.VCardActions, typeof __VLS_components.vCardActions, typeof __VLS_components.VCardActions, typeof __VLS_components.vCardActions, ]} */ ;
// @ts-ignore
const __VLS_65 = __VLS_asFunctionalComponent(__VLS_64, new __VLS_64({}));
const __VLS_66 = __VLS_65({}, ...__VLS_functionalComponentArgsRest(__VLS_65));
__VLS_67.slots.default;
const __VLS_68 = {}.VSpacer;
/** @type {[typeof __VLS_components.VSpacer, typeof __VLS_components.vSpacer, typeof __VLS_components.VSpacer, typeof __VLS_components.vSpacer, ]} */ ;
// @ts-ignore
const __VLS_69 = __VLS_asFunctionalComponent(__VLS_68, new __VLS_68({}));
const __VLS_70 = __VLS_69({}, ...__VLS_functionalComponentArgsRest(__VLS_69));
const __VLS_72 = {}.VBtn;
/** @type {[typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, ]} */ ;
// @ts-ignore
const __VLS_73 = __VLS_asFunctionalComponent(__VLS_72, new __VLS_72({
    ...{ 'onClick': {} },
}));
const __VLS_74 = __VLS_73({
    ...{ 'onClick': {} },
}, ...__VLS_functionalComponentArgsRest(__VLS_73));
let __VLS_76;
let __VLS_77;
let __VLS_78;
const __VLS_79 = {
    onClick: (...[$event]) => {
        __VLS_ctx.completeDialog = false;
    }
};
__VLS_75.slots.default;
var __VLS_75;
const __VLS_80 = {}.VBtn;
/** @type {[typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, ]} */ ;
// @ts-ignore
const __VLS_81 = __VLS_asFunctionalComponent(__VLS_80, new __VLS_80({
    ...{ 'onClick': {} },
    color: "primary",
    loading: (__VLS_ctx.completing),
}));
const __VLS_82 = __VLS_81({
    ...{ 'onClick': {} },
    color: "primary",
    loading: (__VLS_ctx.completing),
}, ...__VLS_functionalComponentArgsRest(__VLS_81));
let __VLS_84;
let __VLS_85;
let __VLS_86;
const __VLS_87 = {
    onClick: (__VLS_ctx.completeIdea)
};
__VLS_83.slots.default;
var __VLS_83;
var __VLS_67;
var __VLS_51;
var __VLS_47;
const __VLS_88 = {}.VSnackbar;
/** @type {[typeof __VLS_components.VSnackbar, typeof __VLS_components.vSnackbar, typeof __VLS_components.VSnackbar, typeof __VLS_components.vSnackbar, ]} */ ;
// @ts-ignore
const __VLS_89 = __VLS_asFunctionalComponent(__VLS_88, new __VLS_88({
    modelValue: (__VLS_ctx.snackbar),
    color: (__VLS_ctx.snackbarColor),
}));
const __VLS_90 = __VLS_89({
    modelValue: (__VLS_ctx.snackbar),
    color: (__VLS_ctx.snackbarColor),
}, ...__VLS_functionalComponentArgsRest(__VLS_89));
__VLS_91.slots.default;
(__VLS_ctx.snackbarText);
var __VLS_91;
var __VLS_3;
/** @type {__VLS_StyleScopedClasses['page-container']} */ ;
/** @type {__VLS_StyleScopedClasses['text-h4']} */ ;
/** @type {__VLS_StyleScopedClasses['page-title']} */ ;
/** @type {__VLS_StyleScopedClasses['text-center']} */ ;
/** @type {__VLS_StyleScopedClasses['mb-4']} */ ;
var __VLS_dollars;
const __VLS_self = (await Promise.resolve().then(() => __importStar(require('vue')))).defineComponent({
    setup() {
        return {
            IdeaCard: IdeaCard_vue_1.default,
            authStore: authStore,
            loading: loading,
            ideas: ideas,
            completeDialog: completeDialog,
            completeNote: completeNote,
            completing: completing,
            snackbar: snackbar,
            snackbarText: snackbarText,
            snackbarColor: snackbarColor,
            viewIdea: viewIdea,
            showCompleteDialog: showCompleteDialog,
            completeIdea: completeIdea,
        };
    },
});
exports.default = (await Promise.resolve().then(() => __importStar(require('vue')))).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
//# sourceMappingURL=InProgressIdeasPage.vue.js.map