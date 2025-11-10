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
const ideas_1 = require("../api/ideas");
const types_1 = require("../types");
const router = (0, vue_router_1.useRouter)();
const loading = (0, vue_1.ref)(true);
const ideas = (0, vue_1.ref)([]);
const approveDialog = (0, vue_1.ref)(false);
const rejectDialog = (0, vue_1.ref)(false);
const reviewNote = (0, vue_1.ref)('');
const processing = (0, vue_1.ref)(false);
const selectedIdea = (0, vue_1.ref)(null);
const snackbar = (0, vue_1.ref)(false);
const snackbarText = (0, vue_1.ref)('');
const snackbarColor = (0, vue_1.ref)('success');
async function loadIdeas() {
    loading.value = true;
    try {
        ideas.value = await ideas_1.ideasApi.getAll({ status: types_1.IdeaStatus.SUBMITTED });
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
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
function showApproveDialog(idea) {
    selectedIdea.value = idea;
    reviewNote.value = '';
    approveDialog.value = true;
}
function showRejectDialog(idea) {
    selectedIdea.value = idea;
    reviewNote.value = '';
    rejectDialog.value = true;
}
async function approveIdea() {
    if (!selectedIdea.value)
        return;
    processing.value = true;
    try {
        await ideas_1.ideasApi.approve(selectedIdea.value.id, { note: reviewNote.value });
        snackbarText.value = 'Idea approved successfully!';
        snackbarColor.value = 'success';
        snackbar.value = true;
        approveDialog.value = false;
        await loadIdeas();
    }
    catch (error) {
        snackbarText.value = error.response?.data?.error || 'Failed to approve idea';
        snackbarColor.value = 'error';
        snackbar.value = true;
    }
    finally {
        processing.value = false;
    }
}
async function rejectIdea() {
    if (!selectedIdea.value)
        return;
    processing.value = true;
    try {
        await ideas_1.ideasApi.reject(selectedIdea.value.id, { note: reviewNote.value });
        snackbarText.value = 'Idea rejected';
        snackbarColor.value = 'info';
        snackbar.value = true;
        rejectDialog.value = false;
        await loadIdeas();
    }
    catch (error) {
        snackbarText.value = error.response?.data?.error || 'Failed to reject idea';
        snackbarColor.value = 'error';
        snackbar.value = true;
    }
    finally {
        processing.value = false;
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
            }));
            const __VLS_23 = __VLS_22({
                key: (idea.id),
                cols: "12",
            }, ...__VLS_functionalComponentArgsRest(__VLS_22));
            __VLS_24.slots.default;
            const __VLS_25 = {}.VCard;
            /** @type {[typeof __VLS_components.VCard, typeof __VLS_components.vCard, typeof __VLS_components.VCard, typeof __VLS_components.vCard, ]} */ ;
            // @ts-ignore
            const __VLS_26 = __VLS_asFunctionalComponent(__VLS_25, new __VLS_25({}));
            const __VLS_27 = __VLS_26({}, ...__VLS_functionalComponentArgsRest(__VLS_26));
            __VLS_28.slots.default;
            const __VLS_29 = {}.VCardTitle;
            /** @type {[typeof __VLS_components.VCardTitle, typeof __VLS_components.vCardTitle, typeof __VLS_components.VCardTitle, typeof __VLS_components.vCardTitle, ]} */ ;
            // @ts-ignore
            const __VLS_30 = __VLS_asFunctionalComponent(__VLS_29, new __VLS_29({}));
            const __VLS_31 = __VLS_30({}, ...__VLS_functionalComponentArgsRest(__VLS_30));
            __VLS_32.slots.default;
            (idea.title);
            var __VLS_32;
            const __VLS_33 = {}.VCardSubtitle;
            /** @type {[typeof __VLS_components.VCardSubtitle, typeof __VLS_components.vCardSubtitle, typeof __VLS_components.VCardSubtitle, typeof __VLS_components.vCardSubtitle, ]} */ ;
            // @ts-ignore
            const __VLS_34 = __VLS_asFunctionalComponent(__VLS_33, new __VLS_33({}));
            const __VLS_35 = __VLS_34({}, ...__VLS_functionalComponentArgsRest(__VLS_34));
            __VLS_36.slots.default;
            const __VLS_37 = {}.VChip;
            /** @type {[typeof __VLS_components.VChip, typeof __VLS_components.vChip, typeof __VLS_components.VChip, typeof __VLS_components.vChip, ]} */ ;
            // @ts-ignore
            const __VLS_38 = __VLS_asFunctionalComponent(__VLS_37, new __VLS_37({
                size: "small",
                variant: "outlined",
                ...{ class: "mr-2" },
            }));
            const __VLS_39 = __VLS_38({
                size: "small",
                variant: "outlined",
                ...{ class: "mr-2" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_38));
            __VLS_40.slots.default;
            (__VLS_ctx.effortLabels[idea.effort]);
            var __VLS_40;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
            (idea.submitter.name);
            (__VLS_ctx.formatDate(idea.submittedAt));
            var __VLS_36;
            const __VLS_41 = {}.VCardText;
            /** @type {[typeof __VLS_components.VCardText, typeof __VLS_components.vCardText, typeof __VLS_components.VCardText, typeof __VLS_components.vCardText, ]} */ ;
            // @ts-ignore
            const __VLS_42 = __VLS_asFunctionalComponent(__VLS_41, new __VLS_41({}));
            const __VLS_43 = __VLS_42({}, ...__VLS_functionalComponentArgsRest(__VLS_42));
            __VLS_44.slots.default;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "mb-3" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.strong, __VLS_intrinsicElements.strong)({});
            __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({});
            (idea.description);
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "mb-3" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.strong, __VLS_intrinsicElements.strong)({});
            __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({});
            (idea.benefits);
            if (idea.tags.length) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
                __VLS_asFunctionalElement(__VLS_intrinsicElements.strong, __VLS_intrinsicElements.strong)({});
                for (const [tag] of __VLS_getVForSourceType((idea.tags))) {
                    const __VLS_45 = {}.VChip;
                    /** @type {[typeof __VLS_components.VChip, typeof __VLS_components.vChip, typeof __VLS_components.VChip, typeof __VLS_components.vChip, ]} */ ;
                    // @ts-ignore
                    const __VLS_46 = __VLS_asFunctionalComponent(__VLS_45, new __VLS_45({
                        key: (tag),
                        size: "small",
                        ...{ class: "mr-1 mt-1" },
                    }));
                    const __VLS_47 = __VLS_46({
                        key: (tag),
                        size: "small",
                        ...{ class: "mr-1 mt-1" },
                    }, ...__VLS_functionalComponentArgsRest(__VLS_46));
                    __VLS_48.slots.default;
                    (tag);
                    var __VLS_48;
                }
            }
            var __VLS_44;
            const __VLS_49 = {}.VCardActions;
            /** @type {[typeof __VLS_components.VCardActions, typeof __VLS_components.vCardActions, typeof __VLS_components.VCardActions, typeof __VLS_components.vCardActions, ]} */ ;
            // @ts-ignore
            const __VLS_50 = __VLS_asFunctionalComponent(__VLS_49, new __VLS_49({}));
            const __VLS_51 = __VLS_50({}, ...__VLS_functionalComponentArgsRest(__VLS_50));
            __VLS_52.slots.default;
            const __VLS_53 = {}.VBtn;
            /** @type {[typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, ]} */ ;
            // @ts-ignore
            const __VLS_54 = __VLS_asFunctionalComponent(__VLS_53, new __VLS_53({
                ...{ 'onClick': {} },
                color: "success",
                variant: "elevated",
                prependIcon: "mdi-check",
            }));
            const __VLS_55 = __VLS_54({
                ...{ 'onClick': {} },
                color: "success",
                variant: "elevated",
                prependIcon: "mdi-check",
            }, ...__VLS_functionalComponentArgsRest(__VLS_54));
            let __VLS_57;
            let __VLS_58;
            let __VLS_59;
            const __VLS_60 = {
                onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.loading))
                        return;
                    if (!(__VLS_ctx.ideas.length))
                        return;
                    __VLS_ctx.showApproveDialog(idea);
                }
            };
            __VLS_56.slots.default;
            var __VLS_56;
            const __VLS_61 = {}.VBtn;
            /** @type {[typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, ]} */ ;
            // @ts-ignore
            const __VLS_62 = __VLS_asFunctionalComponent(__VLS_61, new __VLS_61({
                ...{ 'onClick': {} },
                color: "error",
                variant: "outlined",
                prependIcon: "mdi-close",
            }));
            const __VLS_63 = __VLS_62({
                ...{ 'onClick': {} },
                color: "error",
                variant: "outlined",
                prependIcon: "mdi-close",
            }, ...__VLS_functionalComponentArgsRest(__VLS_62));
            let __VLS_65;
            let __VLS_66;
            let __VLS_67;
            const __VLS_68 = {
                onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.loading))
                        return;
                    if (!(__VLS_ctx.ideas.length))
                        return;
                    __VLS_ctx.showRejectDialog(idea);
                }
            };
            __VLS_64.slots.default;
            var __VLS_64;
            const __VLS_69 = {}.VSpacer;
            /** @type {[typeof __VLS_components.VSpacer, typeof __VLS_components.vSpacer, typeof __VLS_components.VSpacer, typeof __VLS_components.vSpacer, ]} */ ;
            // @ts-ignore
            const __VLS_70 = __VLS_asFunctionalComponent(__VLS_69, new __VLS_69({}));
            const __VLS_71 = __VLS_70({}, ...__VLS_functionalComponentArgsRest(__VLS_70));
            const __VLS_73 = {}.VBtn;
            /** @type {[typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, ]} */ ;
            // @ts-ignore
            const __VLS_74 = __VLS_asFunctionalComponent(__VLS_73, new __VLS_73({
                ...{ 'onClick': {} },
            }));
            const __VLS_75 = __VLS_74({
                ...{ 'onClick': {} },
            }, ...__VLS_functionalComponentArgsRest(__VLS_74));
            let __VLS_77;
            let __VLS_78;
            let __VLS_79;
            const __VLS_80 = {
                onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.loading))
                        return;
                    if (!(__VLS_ctx.ideas.length))
                        return;
                    __VLS_ctx.viewIdea(idea.id);
                }
            };
            __VLS_76.slots.default;
            var __VLS_76;
            var __VLS_52;
            var __VLS_28;
            var __VLS_24;
        }
        var __VLS_20;
    }
    else {
        const __VLS_81 = {}.VAlert;
        /** @type {[typeof __VLS_components.VAlert, typeof __VLS_components.vAlert, typeof __VLS_components.VAlert, typeof __VLS_components.vAlert, ]} */ ;
        // @ts-ignore
        const __VLS_82 = __VLS_asFunctionalComponent(__VLS_81, new __VLS_81({
            type: "info",
        }));
        const __VLS_83 = __VLS_82({
            type: "info",
        }, ...__VLS_functionalComponentArgsRest(__VLS_82));
        __VLS_84.slots.default;
        var __VLS_84;
    }
}
const __VLS_85 = {}.VDialog;
/** @type {[typeof __VLS_components.VDialog, typeof __VLS_components.vDialog, typeof __VLS_components.VDialog, typeof __VLS_components.vDialog, ]} */ ;
// @ts-ignore
const __VLS_86 = __VLS_asFunctionalComponent(__VLS_85, new __VLS_85({
    modelValue: (__VLS_ctx.approveDialog),
    maxWidth: "500",
}));
const __VLS_87 = __VLS_86({
    modelValue: (__VLS_ctx.approveDialog),
    maxWidth: "500",
}, ...__VLS_functionalComponentArgsRest(__VLS_86));
__VLS_88.slots.default;
const __VLS_89 = {}.VCard;
/** @type {[typeof __VLS_components.VCard, typeof __VLS_components.vCard, typeof __VLS_components.VCard, typeof __VLS_components.vCard, ]} */ ;
// @ts-ignore
const __VLS_90 = __VLS_asFunctionalComponent(__VLS_89, new __VLS_89({}));
const __VLS_91 = __VLS_90({}, ...__VLS_functionalComponentArgsRest(__VLS_90));
__VLS_92.slots.default;
const __VLS_93 = {}.VCardTitle;
/** @type {[typeof __VLS_components.VCardTitle, typeof __VLS_components.vCardTitle, typeof __VLS_components.VCardTitle, typeof __VLS_components.vCardTitle, ]} */ ;
// @ts-ignore
const __VLS_94 = __VLS_asFunctionalComponent(__VLS_93, new __VLS_93({}));
const __VLS_95 = __VLS_94({}, ...__VLS_functionalComponentArgsRest(__VLS_94));
__VLS_96.slots.default;
var __VLS_96;
const __VLS_97 = {}.VCardText;
/** @type {[typeof __VLS_components.VCardText, typeof __VLS_components.vCardText, typeof __VLS_components.VCardText, typeof __VLS_components.vCardText, ]} */ ;
// @ts-ignore
const __VLS_98 = __VLS_asFunctionalComponent(__VLS_97, new __VLS_97({}));
const __VLS_99 = __VLS_98({}, ...__VLS_functionalComponentArgsRest(__VLS_98));
__VLS_100.slots.default;
__VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
    ...{ class: "mb-4" },
});
(__VLS_ctx.selectedIdea?.title);
const __VLS_101 = {}.VTextarea;
/** @type {[typeof __VLS_components.VTextarea, typeof __VLS_components.vTextarea, typeof __VLS_components.VTextarea, typeof __VLS_components.vTextarea, ]} */ ;
// @ts-ignore
const __VLS_102 = __VLS_asFunctionalComponent(__VLS_101, new __VLS_101({
    modelValue: (__VLS_ctx.reviewNote),
    label: "Approval notes (optional)",
    variant: "outlined",
    rows: "3",
}));
const __VLS_103 = __VLS_102({
    modelValue: (__VLS_ctx.reviewNote),
    label: "Approval notes (optional)",
    variant: "outlined",
    rows: "3",
}, ...__VLS_functionalComponentArgsRest(__VLS_102));
var __VLS_100;
const __VLS_105 = {}.VCardActions;
/** @type {[typeof __VLS_components.VCardActions, typeof __VLS_components.vCardActions, typeof __VLS_components.VCardActions, typeof __VLS_components.vCardActions, ]} */ ;
// @ts-ignore
const __VLS_106 = __VLS_asFunctionalComponent(__VLS_105, new __VLS_105({}));
const __VLS_107 = __VLS_106({}, ...__VLS_functionalComponentArgsRest(__VLS_106));
__VLS_108.slots.default;
const __VLS_109 = {}.VSpacer;
/** @type {[typeof __VLS_components.VSpacer, typeof __VLS_components.vSpacer, typeof __VLS_components.VSpacer, typeof __VLS_components.vSpacer, ]} */ ;
// @ts-ignore
const __VLS_110 = __VLS_asFunctionalComponent(__VLS_109, new __VLS_109({}));
const __VLS_111 = __VLS_110({}, ...__VLS_functionalComponentArgsRest(__VLS_110));
const __VLS_113 = {}.VBtn;
/** @type {[typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, ]} */ ;
// @ts-ignore
const __VLS_114 = __VLS_asFunctionalComponent(__VLS_113, new __VLS_113({
    ...{ 'onClick': {} },
}));
const __VLS_115 = __VLS_114({
    ...{ 'onClick': {} },
}, ...__VLS_functionalComponentArgsRest(__VLS_114));
let __VLS_117;
let __VLS_118;
let __VLS_119;
const __VLS_120 = {
    onClick: (...[$event]) => {
        __VLS_ctx.approveDialog = false;
    }
};
__VLS_116.slots.default;
var __VLS_116;
const __VLS_121 = {}.VBtn;
/** @type {[typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, ]} */ ;
// @ts-ignore
const __VLS_122 = __VLS_asFunctionalComponent(__VLS_121, new __VLS_121({
    ...{ 'onClick': {} },
    color: "success",
    loading: (__VLS_ctx.processing),
}));
const __VLS_123 = __VLS_122({
    ...{ 'onClick': {} },
    color: "success",
    loading: (__VLS_ctx.processing),
}, ...__VLS_functionalComponentArgsRest(__VLS_122));
let __VLS_125;
let __VLS_126;
let __VLS_127;
const __VLS_128 = {
    onClick: (__VLS_ctx.approveIdea)
};
__VLS_124.slots.default;
var __VLS_124;
var __VLS_108;
var __VLS_92;
var __VLS_88;
const __VLS_129 = {}.VDialog;
/** @type {[typeof __VLS_components.VDialog, typeof __VLS_components.vDialog, typeof __VLS_components.VDialog, typeof __VLS_components.vDialog, ]} */ ;
// @ts-ignore
const __VLS_130 = __VLS_asFunctionalComponent(__VLS_129, new __VLS_129({
    modelValue: (__VLS_ctx.rejectDialog),
    maxWidth: "500",
}));
const __VLS_131 = __VLS_130({
    modelValue: (__VLS_ctx.rejectDialog),
    maxWidth: "500",
}, ...__VLS_functionalComponentArgsRest(__VLS_130));
__VLS_132.slots.default;
const __VLS_133 = {}.VCard;
/** @type {[typeof __VLS_components.VCard, typeof __VLS_components.vCard, typeof __VLS_components.VCard, typeof __VLS_components.vCard, ]} */ ;
// @ts-ignore
const __VLS_134 = __VLS_asFunctionalComponent(__VLS_133, new __VLS_133({}));
const __VLS_135 = __VLS_134({}, ...__VLS_functionalComponentArgsRest(__VLS_134));
__VLS_136.slots.default;
const __VLS_137 = {}.VCardTitle;
/** @type {[typeof __VLS_components.VCardTitle, typeof __VLS_components.vCardTitle, typeof __VLS_components.VCardTitle, typeof __VLS_components.vCardTitle, ]} */ ;
// @ts-ignore
const __VLS_138 = __VLS_asFunctionalComponent(__VLS_137, new __VLS_137({}));
const __VLS_139 = __VLS_138({}, ...__VLS_functionalComponentArgsRest(__VLS_138));
__VLS_140.slots.default;
var __VLS_140;
const __VLS_141 = {}.VCardText;
/** @type {[typeof __VLS_components.VCardText, typeof __VLS_components.vCardText, typeof __VLS_components.VCardText, typeof __VLS_components.vCardText, ]} */ ;
// @ts-ignore
const __VLS_142 = __VLS_asFunctionalComponent(__VLS_141, new __VLS_141({}));
const __VLS_143 = __VLS_142({}, ...__VLS_functionalComponentArgsRest(__VLS_142));
__VLS_144.slots.default;
__VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
    ...{ class: "mb-4" },
});
(__VLS_ctx.selectedIdea?.title);
const __VLS_145 = {}.VTextarea;
/** @type {[typeof __VLS_components.VTextarea, typeof __VLS_components.vTextarea, typeof __VLS_components.VTextarea, typeof __VLS_components.vTextarea, ]} */ ;
// @ts-ignore
const __VLS_146 = __VLS_asFunctionalComponent(__VLS_145, new __VLS_145({
    modelValue: (__VLS_ctx.reviewNote),
    label: "Rejection reason (recommended)",
    variant: "outlined",
    rows: "3",
}));
const __VLS_147 = __VLS_146({
    modelValue: (__VLS_ctx.reviewNote),
    label: "Rejection reason (recommended)",
    variant: "outlined",
    rows: "3",
}, ...__VLS_functionalComponentArgsRest(__VLS_146));
var __VLS_144;
const __VLS_149 = {}.VCardActions;
/** @type {[typeof __VLS_components.VCardActions, typeof __VLS_components.vCardActions, typeof __VLS_components.VCardActions, typeof __VLS_components.vCardActions, ]} */ ;
// @ts-ignore
const __VLS_150 = __VLS_asFunctionalComponent(__VLS_149, new __VLS_149({}));
const __VLS_151 = __VLS_150({}, ...__VLS_functionalComponentArgsRest(__VLS_150));
__VLS_152.slots.default;
const __VLS_153 = {}.VSpacer;
/** @type {[typeof __VLS_components.VSpacer, typeof __VLS_components.vSpacer, typeof __VLS_components.VSpacer, typeof __VLS_components.vSpacer, ]} */ ;
// @ts-ignore
const __VLS_154 = __VLS_asFunctionalComponent(__VLS_153, new __VLS_153({}));
const __VLS_155 = __VLS_154({}, ...__VLS_functionalComponentArgsRest(__VLS_154));
const __VLS_157 = {}.VBtn;
/** @type {[typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, ]} */ ;
// @ts-ignore
const __VLS_158 = __VLS_asFunctionalComponent(__VLS_157, new __VLS_157({
    ...{ 'onClick': {} },
}));
const __VLS_159 = __VLS_158({
    ...{ 'onClick': {} },
}, ...__VLS_functionalComponentArgsRest(__VLS_158));
let __VLS_161;
let __VLS_162;
let __VLS_163;
const __VLS_164 = {
    onClick: (...[$event]) => {
        __VLS_ctx.rejectDialog = false;
    }
};
__VLS_160.slots.default;
var __VLS_160;
const __VLS_165 = {}.VBtn;
/** @type {[typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, ]} */ ;
// @ts-ignore
const __VLS_166 = __VLS_asFunctionalComponent(__VLS_165, new __VLS_165({
    ...{ 'onClick': {} },
    color: "error",
    loading: (__VLS_ctx.processing),
}));
const __VLS_167 = __VLS_166({
    ...{ 'onClick': {} },
    color: "error",
    loading: (__VLS_ctx.processing),
}, ...__VLS_functionalComponentArgsRest(__VLS_166));
let __VLS_169;
let __VLS_170;
let __VLS_171;
const __VLS_172 = {
    onClick: (__VLS_ctx.rejectIdea)
};
__VLS_168.slots.default;
var __VLS_168;
var __VLS_152;
var __VLS_136;
var __VLS_132;
const __VLS_173 = {}.VSnackbar;
/** @type {[typeof __VLS_components.VSnackbar, typeof __VLS_components.vSnackbar, typeof __VLS_components.VSnackbar, typeof __VLS_components.vSnackbar, ]} */ ;
// @ts-ignore
const __VLS_174 = __VLS_asFunctionalComponent(__VLS_173, new __VLS_173({
    modelValue: (__VLS_ctx.snackbar),
    color: (__VLS_ctx.snackbarColor),
}));
const __VLS_175 = __VLS_174({
    modelValue: (__VLS_ctx.snackbar),
    color: (__VLS_ctx.snackbarColor),
}, ...__VLS_functionalComponentArgsRest(__VLS_174));
__VLS_176.slots.default;
(__VLS_ctx.snackbarText);
var __VLS_176;
var __VLS_3;
/** @type {__VLS_StyleScopedClasses['page-container']} */ ;
/** @type {__VLS_StyleScopedClasses['text-h4']} */ ;
/** @type {__VLS_StyleScopedClasses['page-title']} */ ;
/** @type {__VLS_StyleScopedClasses['text-subtitle-1']} */ ;
/** @type {__VLS_StyleScopedClasses['mb-4']} */ ;
/** @type {__VLS_StyleScopedClasses['text-center']} */ ;
/** @type {__VLS_StyleScopedClasses['mr-2']} */ ;
/** @type {__VLS_StyleScopedClasses['mb-3']} */ ;
/** @type {__VLS_StyleScopedClasses['mb-3']} */ ;
/** @type {__VLS_StyleScopedClasses['mr-1']} */ ;
/** @type {__VLS_StyleScopedClasses['mt-1']} */ ;
/** @type {__VLS_StyleScopedClasses['mb-4']} */ ;
/** @type {__VLS_StyleScopedClasses['mb-4']} */ ;
var __VLS_dollars;
const __VLS_self = (await Promise.resolve().then(() => __importStar(require('vue')))).defineComponent({
    setup() {
        return {
            effortLabels: types_1.effortLabels,
            loading: loading,
            ideas: ideas,
            approveDialog: approveDialog,
            rejectDialog: rejectDialog,
            reviewNote: reviewNote,
            processing: processing,
            selectedIdea: selectedIdea,
            snackbar: snackbar,
            snackbarText: snackbarText,
            snackbarColor: snackbarColor,
            viewIdea: viewIdea,
            formatDate: formatDate,
            showApproveDialog: showApproveDialog,
            showRejectDialog: showRejectDialog,
            approveIdea: approveIdea,
            rejectIdea: rejectIdea,
        };
    },
});
exports.default = (await Promise.resolve().then(() => __importStar(require('vue')))).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
//# sourceMappingURL=ReviewQueuePage.vue.js.map