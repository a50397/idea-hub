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
const ideas_1 = require("../api/ideas");
const types_1 = require("../types");
const effortOptions = [
    { title: types_1.effortLabels[types_1.Effort.LESS_THAN_ONE_DAY], value: types_1.Effort.LESS_THAN_ONE_DAY },
    { title: types_1.effortLabels[types_1.Effort.ONE_TO_THREE_DAYS], value: types_1.Effort.ONE_TO_THREE_DAYS },
    { title: types_1.effortLabels[types_1.Effort.MORE_THAN_THREE_DAYS], value: types_1.Effort.MORE_THAN_THREE_DAYS },
];
const formData = (0, vue_1.reactive)({
    title: '',
    description: '',
    benefits: '',
    effort: null,
    tags: [],
});
const errors = (0, vue_1.reactive)({
    title: [],
    description: [],
    benefits: [],
    effort: [],
});
const submitting = (0, vue_1.ref)(false);
const submitError = (0, vue_1.ref)('');
const submitSuccess = (0, vue_1.ref)(false);
function validateForm() {
    errors.title = [];
    errors.description = [];
    errors.benefits = [];
    errors.effort = [];
    if (!formData.title || formData.title.length < 5) {
        errors.title.push('Title must be at least 5 characters');
    }
    if (formData.title.length > 120) {
        errors.title.push('Title must be at most 120 characters');
    }
    if (!formData.description || formData.description.length < 10) {
        errors.description.push('Description must be at least 10 characters');
    }
    if (formData.description.length > 3000) {
        errors.description.push('Description must be at most 3000 characters');
    }
    if (!formData.benefits || formData.benefits.length < 10) {
        errors.benefits.push('Benefits must be at least 10 characters');
    }
    if (formData.benefits.length > 3000) {
        errors.benefits.push('Benefits must be at most 3000 characters');
    }
    if (!formData.effort) {
        errors.effort.push('Effort estimation is required');
    }
    return !errors.title.length && !errors.description.length && !errors.benefits.length && !errors.effort.length;
}
async function handleSubmit() {
    submitError.value = '';
    submitSuccess.value = false;
    if (!validateForm()) {
        return;
    }
    submitting.value = true;
    try {
        await ideas_1.ideasApi.create({
            title: formData.title,
            description: formData.description,
            benefits: formData.benefits,
            effort: formData.effort,
            tags: formData.tags,
        });
        submitSuccess.value = true;
        resetForm();
        setTimeout(() => {
            submitSuccess.value = false;
        }, 5000);
    }
    catch (error) {
        submitError.value = error.response?.data?.error || 'Failed to submit idea';
    }
    finally {
        submitting.value = false;
    }
}
function resetForm() {
    formData.title = '';
    formData.description = '';
    formData.benefits = '';
    formData.effort = null;
    formData.tags = [];
    errors.title = [];
    errors.description = [];
    errors.benefits = [];
    errors.effort = [];
}
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
    md: "8",
}));
const __VLS_11 = __VLS_10({
    cols: "12",
    md: "8",
}, ...__VLS_functionalComponentArgsRest(__VLS_10));
__VLS_12.slots.default;
const __VLS_13 = {}.VCard;
/** @type {[typeof __VLS_components.VCard, typeof __VLS_components.vCard, typeof __VLS_components.VCard, typeof __VLS_components.vCard, ]} */ ;
// @ts-ignore
const __VLS_14 = __VLS_asFunctionalComponent(__VLS_13, new __VLS_13({}));
const __VLS_15 = __VLS_14({}, ...__VLS_functionalComponentArgsRest(__VLS_14));
__VLS_16.slots.default;
const __VLS_17 = {}.VCardText;
/** @type {[typeof __VLS_components.VCardText, typeof __VLS_components.vCardText, typeof __VLS_components.VCardText, typeof __VLS_components.vCardText, ]} */ ;
// @ts-ignore
const __VLS_18 = __VLS_asFunctionalComponent(__VLS_17, new __VLS_17({}));
const __VLS_19 = __VLS_18({}, ...__VLS_functionalComponentArgsRest(__VLS_18));
__VLS_20.slots.default;
const __VLS_21 = {}.VForm;
/** @type {[typeof __VLS_components.VForm, typeof __VLS_components.vForm, typeof __VLS_components.VForm, typeof __VLS_components.vForm, ]} */ ;
// @ts-ignore
const __VLS_22 = __VLS_asFunctionalComponent(__VLS_21, new __VLS_21({
    ...{ 'onSubmit': {} },
}));
const __VLS_23 = __VLS_22({
    ...{ 'onSubmit': {} },
}, ...__VLS_functionalComponentArgsRest(__VLS_22));
let __VLS_25;
let __VLS_26;
let __VLS_27;
const __VLS_28 = {
    onSubmit: (__VLS_ctx.handleSubmit)
};
__VLS_24.slots.default;
const __VLS_29 = {}.VTextField;
/** @type {[typeof __VLS_components.VTextField, typeof __VLS_components.vTextField, typeof __VLS_components.VTextField, typeof __VLS_components.vTextField, ]} */ ;
// @ts-ignore
const __VLS_30 = __VLS_asFunctionalComponent(__VLS_29, new __VLS_29({
    modelValue: (__VLS_ctx.formData.title),
    label: "Title *",
    variant: "outlined",
    errorMessages: (__VLS_ctx.errors.title),
    counter: "120",
    hint: "5-120 characters",
    persistentHint: true,
}));
const __VLS_31 = __VLS_30({
    modelValue: (__VLS_ctx.formData.title),
    label: "Title *",
    variant: "outlined",
    errorMessages: (__VLS_ctx.errors.title),
    counter: "120",
    hint: "5-120 characters",
    persistentHint: true,
}, ...__VLS_functionalComponentArgsRest(__VLS_30));
const __VLS_33 = {}.VTextarea;
/** @type {[typeof __VLS_components.VTextarea, typeof __VLS_components.vTextarea, typeof __VLS_components.VTextarea, typeof __VLS_components.vTextarea, ]} */ ;
// @ts-ignore
const __VLS_34 = __VLS_asFunctionalComponent(__VLS_33, new __VLS_33({
    modelValue: (__VLS_ctx.formData.description),
    label: "Description *",
    variant: "outlined",
    errorMessages: (__VLS_ctx.errors.description),
    counter: "3000",
    rows: "5",
    hint: "Describe your idea in detail (10-3000 characters)",
    persistentHint: true,
}));
const __VLS_35 = __VLS_34({
    modelValue: (__VLS_ctx.formData.description),
    label: "Description *",
    variant: "outlined",
    errorMessages: (__VLS_ctx.errors.description),
    counter: "3000",
    rows: "5",
    hint: "Describe your idea in detail (10-3000 characters)",
    persistentHint: true,
}, ...__VLS_functionalComponentArgsRest(__VLS_34));
const __VLS_37 = {}.VTextarea;
/** @type {[typeof __VLS_components.VTextarea, typeof __VLS_components.vTextarea, typeof __VLS_components.VTextarea, typeof __VLS_components.vTextarea, ]} */ ;
// @ts-ignore
const __VLS_38 = __VLS_asFunctionalComponent(__VLS_37, new __VLS_37({
    modelValue: (__VLS_ctx.formData.benefits),
    label: "Benefits *",
    variant: "outlined",
    errorMessages: (__VLS_ctx.errors.benefits),
    counter: "3000",
    rows: "4",
    hint: "What are the expected benefits? (10-3000 characters)",
    persistentHint: true,
}));
const __VLS_39 = __VLS_38({
    modelValue: (__VLS_ctx.formData.benefits),
    label: "Benefits *",
    variant: "outlined",
    errorMessages: (__VLS_ctx.errors.benefits),
    counter: "3000",
    rows: "4",
    hint: "What are the expected benefits? (10-3000 characters)",
    persistentHint: true,
}, ...__VLS_functionalComponentArgsRest(__VLS_38));
const __VLS_41 = {}.VSelect;
/** @type {[typeof __VLS_components.VSelect, typeof __VLS_components.vSelect, typeof __VLS_components.VSelect, typeof __VLS_components.vSelect, ]} */ ;
// @ts-ignore
const __VLS_42 = __VLS_asFunctionalComponent(__VLS_41, new __VLS_41({
    modelValue: (__VLS_ctx.formData.effort),
    label: "Estimated Effort *",
    items: (__VLS_ctx.effortOptions),
    variant: "outlined",
    errorMessages: (__VLS_ctx.errors.effort),
}));
const __VLS_43 = __VLS_42({
    modelValue: (__VLS_ctx.formData.effort),
    label: "Estimated Effort *",
    items: (__VLS_ctx.effortOptions),
    variant: "outlined",
    errorMessages: (__VLS_ctx.errors.effort),
}, ...__VLS_functionalComponentArgsRest(__VLS_42));
const __VLS_45 = {}.VCombobox;
/** @type {[typeof __VLS_components.VCombobox, typeof __VLS_components.vCombobox, typeof __VLS_components.VCombobox, typeof __VLS_components.vCombobox, ]} */ ;
// @ts-ignore
const __VLS_46 = __VLS_asFunctionalComponent(__VLS_45, new __VLS_45({
    modelValue: (__VLS_ctx.formData.tags),
    label: "Tags (optional)",
    variant: "outlined",
    multiple: true,
    chips: true,
    closableChips: true,
    hint: "Press Enter to add a tag",
    persistentHint: true,
}));
const __VLS_47 = __VLS_46({
    modelValue: (__VLS_ctx.formData.tags),
    label: "Tags (optional)",
    variant: "outlined",
    multiple: true,
    chips: true,
    closableChips: true,
    hint: "Press Enter to add a tag",
    persistentHint: true,
}, ...__VLS_functionalComponentArgsRest(__VLS_46));
if (__VLS_ctx.submitError) {
    const __VLS_49 = {}.VAlert;
    /** @type {[typeof __VLS_components.VAlert, typeof __VLS_components.vAlert, typeof __VLS_components.VAlert, typeof __VLS_components.vAlert, ]} */ ;
    // @ts-ignore
    const __VLS_50 = __VLS_asFunctionalComponent(__VLS_49, new __VLS_49({
        type: "error",
        ...{ class: "mt-4" },
    }));
    const __VLS_51 = __VLS_50({
        type: "error",
        ...{ class: "mt-4" },
    }, ...__VLS_functionalComponentArgsRest(__VLS_50));
    __VLS_52.slots.default;
    (__VLS_ctx.submitError);
    var __VLS_52;
}
if (__VLS_ctx.submitSuccess) {
    const __VLS_53 = {}.VAlert;
    /** @type {[typeof __VLS_components.VAlert, typeof __VLS_components.vAlert, typeof __VLS_components.VAlert, typeof __VLS_components.vAlert, ]} */ ;
    // @ts-ignore
    const __VLS_54 = __VLS_asFunctionalComponent(__VLS_53, new __VLS_53({
        type: "success",
        ...{ class: "mt-4" },
    }));
    const __VLS_55 = __VLS_54({
        type: "success",
        ...{ class: "mt-4" },
    }, ...__VLS_functionalComponentArgsRest(__VLS_54));
    __VLS_56.slots.default;
    var __VLS_56;
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "mt-4" },
});
const __VLS_57 = {}.VBtn;
/** @type {[typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, ]} */ ;
// @ts-ignore
const __VLS_58 = __VLS_asFunctionalComponent(__VLS_57, new __VLS_57({
    type: "submit",
    color: "primary",
    size: "large",
    loading: (__VLS_ctx.submitting),
    prependIcon: "mdi-send",
}));
const __VLS_59 = __VLS_58({
    type: "submit",
    color: "primary",
    size: "large",
    loading: (__VLS_ctx.submitting),
    prependIcon: "mdi-send",
}, ...__VLS_functionalComponentArgsRest(__VLS_58));
__VLS_60.slots.default;
var __VLS_60;
const __VLS_61 = {}.VBtn;
/** @type {[typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, ]} */ ;
// @ts-ignore
const __VLS_62 = __VLS_asFunctionalComponent(__VLS_61, new __VLS_61({
    ...{ 'onClick': {} },
    ...{ class: "ml-2" },
    variant: "outlined",
}));
const __VLS_63 = __VLS_62({
    ...{ 'onClick': {} },
    ...{ class: "ml-2" },
    variant: "outlined",
}, ...__VLS_functionalComponentArgsRest(__VLS_62));
let __VLS_65;
let __VLS_66;
let __VLS_67;
const __VLS_68 = {
    onClick: (__VLS_ctx.resetForm)
};
__VLS_64.slots.default;
var __VLS_64;
var __VLS_24;
var __VLS_20;
var __VLS_16;
var __VLS_12;
const __VLS_69 = {}.VCol;
/** @type {[typeof __VLS_components.VCol, typeof __VLS_components.vCol, typeof __VLS_components.VCol, typeof __VLS_components.vCol, ]} */ ;
// @ts-ignore
const __VLS_70 = __VLS_asFunctionalComponent(__VLS_69, new __VLS_69({
    cols: "12",
    md: "4",
}));
const __VLS_71 = __VLS_70({
    cols: "12",
    md: "4",
}, ...__VLS_functionalComponentArgsRest(__VLS_70));
__VLS_72.slots.default;
const __VLS_73 = {}.VCard;
/** @type {[typeof __VLS_components.VCard, typeof __VLS_components.vCard, typeof __VLS_components.VCard, typeof __VLS_components.vCard, ]} */ ;
// @ts-ignore
const __VLS_74 = __VLS_asFunctionalComponent(__VLS_73, new __VLS_73({}));
const __VLS_75 = __VLS_74({}, ...__VLS_functionalComponentArgsRest(__VLS_74));
__VLS_76.slots.default;
const __VLS_77 = {}.VCardTitle;
/** @type {[typeof __VLS_components.VCardTitle, typeof __VLS_components.vCardTitle, typeof __VLS_components.VCardTitle, typeof __VLS_components.vCardTitle, ]} */ ;
// @ts-ignore
const __VLS_78 = __VLS_asFunctionalComponent(__VLS_77, new __VLS_77({}));
const __VLS_79 = __VLS_78({}, ...__VLS_functionalComponentArgsRest(__VLS_78));
__VLS_80.slots.default;
var __VLS_80;
const __VLS_81 = {}.VCardText;
/** @type {[typeof __VLS_components.VCardText, typeof __VLS_components.vCardText, typeof __VLS_components.VCardText, typeof __VLS_components.vCardText, ]} */ ;
// @ts-ignore
const __VLS_82 = __VLS_asFunctionalComponent(__VLS_81, new __VLS_81({}));
const __VLS_83 = __VLS_82({}, ...__VLS_functionalComponentArgsRest(__VLS_82));
__VLS_84.slots.default;
const __VLS_85 = {}.VList;
/** @type {[typeof __VLS_components.VList, typeof __VLS_components.vList, typeof __VLS_components.VList, typeof __VLS_components.vList, ]} */ ;
// @ts-ignore
const __VLS_86 = __VLS_asFunctionalComponent(__VLS_85, new __VLS_85({
    density: "compact",
}));
const __VLS_87 = __VLS_86({
    density: "compact",
}, ...__VLS_functionalComponentArgsRest(__VLS_86));
__VLS_88.slots.default;
const __VLS_89 = {}.VListItem;
/** @type {[typeof __VLS_components.VListItem, typeof __VLS_components.vListItem, typeof __VLS_components.VListItem, typeof __VLS_components.vListItem, ]} */ ;
// @ts-ignore
const __VLS_90 = __VLS_asFunctionalComponent(__VLS_89, new __VLS_89({}));
const __VLS_91 = __VLS_90({}, ...__VLS_functionalComponentArgsRest(__VLS_90));
__VLS_92.slots.default;
{
    const { prepend: __VLS_thisSlot } = __VLS_92.slots;
    const __VLS_93 = {}.VIcon;
    /** @type {[typeof __VLS_components.VIcon, typeof __VLS_components.vIcon, typeof __VLS_components.VIcon, typeof __VLS_components.vIcon, ]} */ ;
    // @ts-ignore
    const __VLS_94 = __VLS_asFunctionalComponent(__VLS_93, new __VLS_93({}));
    const __VLS_95 = __VLS_94({}, ...__VLS_functionalComponentArgsRest(__VLS_94));
    __VLS_96.slots.default;
    var __VLS_96;
}
const __VLS_97 = {}.VListItemTitle;
/** @type {[typeof __VLS_components.VListItemTitle, typeof __VLS_components.vListItemTitle, typeof __VLS_components.VListItemTitle, typeof __VLS_components.vListItemTitle, ]} */ ;
// @ts-ignore
const __VLS_98 = __VLS_asFunctionalComponent(__VLS_97, new __VLS_97({}));
const __VLS_99 = __VLS_98({}, ...__VLS_functionalComponentArgsRest(__VLS_98));
__VLS_100.slots.default;
var __VLS_100;
var __VLS_92;
const __VLS_101 = {}.VListItem;
/** @type {[typeof __VLS_components.VListItem, typeof __VLS_components.vListItem, typeof __VLS_components.VListItem, typeof __VLS_components.vListItem, ]} */ ;
// @ts-ignore
const __VLS_102 = __VLS_asFunctionalComponent(__VLS_101, new __VLS_101({}));
const __VLS_103 = __VLS_102({}, ...__VLS_functionalComponentArgsRest(__VLS_102));
__VLS_104.slots.default;
{
    const { prepend: __VLS_thisSlot } = __VLS_104.slots;
    const __VLS_105 = {}.VIcon;
    /** @type {[typeof __VLS_components.VIcon, typeof __VLS_components.vIcon, typeof __VLS_components.VIcon, typeof __VLS_components.vIcon, ]} */ ;
    // @ts-ignore
    const __VLS_106 = __VLS_asFunctionalComponent(__VLS_105, new __VLS_105({}));
    const __VLS_107 = __VLS_106({}, ...__VLS_functionalComponentArgsRest(__VLS_106));
    __VLS_108.slots.default;
    var __VLS_108;
}
const __VLS_109 = {}.VListItemTitle;
/** @type {[typeof __VLS_components.VListItemTitle, typeof __VLS_components.vListItemTitle, typeof __VLS_components.VListItemTitle, typeof __VLS_components.vListItemTitle, ]} */ ;
// @ts-ignore
const __VLS_110 = __VLS_asFunctionalComponent(__VLS_109, new __VLS_109({}));
const __VLS_111 = __VLS_110({}, ...__VLS_functionalComponentArgsRest(__VLS_110));
__VLS_112.slots.default;
var __VLS_112;
var __VLS_104;
const __VLS_113 = {}.VListItem;
/** @type {[typeof __VLS_components.VListItem, typeof __VLS_components.vListItem, typeof __VLS_components.VListItem, typeof __VLS_components.vListItem, ]} */ ;
// @ts-ignore
const __VLS_114 = __VLS_asFunctionalComponent(__VLS_113, new __VLS_113({}));
const __VLS_115 = __VLS_114({}, ...__VLS_functionalComponentArgsRest(__VLS_114));
__VLS_116.slots.default;
{
    const { prepend: __VLS_thisSlot } = __VLS_116.slots;
    const __VLS_117 = {}.VIcon;
    /** @type {[typeof __VLS_components.VIcon, typeof __VLS_components.vIcon, typeof __VLS_components.VIcon, typeof __VLS_components.vIcon, ]} */ ;
    // @ts-ignore
    const __VLS_118 = __VLS_asFunctionalComponent(__VLS_117, new __VLS_117({}));
    const __VLS_119 = __VLS_118({}, ...__VLS_functionalComponentArgsRest(__VLS_118));
    __VLS_120.slots.default;
    var __VLS_120;
}
const __VLS_121 = {}.VListItemTitle;
/** @type {[typeof __VLS_components.VListItemTitle, typeof __VLS_components.vListItemTitle, typeof __VLS_components.VListItemTitle, typeof __VLS_components.vListItemTitle, ]} */ ;
// @ts-ignore
const __VLS_122 = __VLS_asFunctionalComponent(__VLS_121, new __VLS_121({}));
const __VLS_123 = __VLS_122({}, ...__VLS_functionalComponentArgsRest(__VLS_122));
__VLS_124.slots.default;
var __VLS_124;
var __VLS_116;
const __VLS_125 = {}.VListItem;
/** @type {[typeof __VLS_components.VListItem, typeof __VLS_components.vListItem, typeof __VLS_components.VListItem, typeof __VLS_components.vListItem, ]} */ ;
// @ts-ignore
const __VLS_126 = __VLS_asFunctionalComponent(__VLS_125, new __VLS_125({}));
const __VLS_127 = __VLS_126({}, ...__VLS_functionalComponentArgsRest(__VLS_126));
__VLS_128.slots.default;
{
    const { prepend: __VLS_thisSlot } = __VLS_128.slots;
    const __VLS_129 = {}.VIcon;
    /** @type {[typeof __VLS_components.VIcon, typeof __VLS_components.vIcon, typeof __VLS_components.VIcon, typeof __VLS_components.vIcon, ]} */ ;
    // @ts-ignore
    const __VLS_130 = __VLS_asFunctionalComponent(__VLS_129, new __VLS_129({}));
    const __VLS_131 = __VLS_130({}, ...__VLS_functionalComponentArgsRest(__VLS_130));
    __VLS_132.slots.default;
    var __VLS_132;
}
const __VLS_133 = {}.VListItemTitle;
/** @type {[typeof __VLS_components.VListItemTitle, typeof __VLS_components.vListItemTitle, typeof __VLS_components.VListItemTitle, typeof __VLS_components.vListItemTitle, ]} */ ;
// @ts-ignore
const __VLS_134 = __VLS_asFunctionalComponent(__VLS_133, new __VLS_133({}));
const __VLS_135 = __VLS_134({}, ...__VLS_functionalComponentArgsRest(__VLS_134));
__VLS_136.slots.default;
var __VLS_136;
var __VLS_128;
const __VLS_137 = {}.VListItem;
/** @type {[typeof __VLS_components.VListItem, typeof __VLS_components.vListItem, typeof __VLS_components.VListItem, typeof __VLS_components.vListItem, ]} */ ;
// @ts-ignore
const __VLS_138 = __VLS_asFunctionalComponent(__VLS_137, new __VLS_137({}));
const __VLS_139 = __VLS_138({}, ...__VLS_functionalComponentArgsRest(__VLS_138));
__VLS_140.slots.default;
{
    const { prepend: __VLS_thisSlot } = __VLS_140.slots;
    const __VLS_141 = {}.VIcon;
    /** @type {[typeof __VLS_components.VIcon, typeof __VLS_components.vIcon, typeof __VLS_components.VIcon, typeof __VLS_components.vIcon, ]} */ ;
    // @ts-ignore
    const __VLS_142 = __VLS_asFunctionalComponent(__VLS_141, new __VLS_141({}));
    const __VLS_143 = __VLS_142({}, ...__VLS_functionalComponentArgsRest(__VLS_142));
    __VLS_144.slots.default;
    var __VLS_144;
}
const __VLS_145 = {}.VListItemTitle;
/** @type {[typeof __VLS_components.VListItemTitle, typeof __VLS_components.vListItemTitle, typeof __VLS_components.VListItemTitle, typeof __VLS_components.vListItemTitle, ]} */ ;
// @ts-ignore
const __VLS_146 = __VLS_asFunctionalComponent(__VLS_145, new __VLS_145({}));
const __VLS_147 = __VLS_146({}, ...__VLS_functionalComponentArgsRest(__VLS_146));
__VLS_148.slots.default;
var __VLS_148;
var __VLS_140;
var __VLS_88;
var __VLS_84;
var __VLS_76;
var __VLS_72;
var __VLS_8;
var __VLS_3;
/** @type {__VLS_StyleScopedClasses['page-container']} */ ;
/** @type {__VLS_StyleScopedClasses['text-h4']} */ ;
/** @type {__VLS_StyleScopedClasses['page-title']} */ ;
/** @type {__VLS_StyleScopedClasses['mt-4']} */ ;
/** @type {__VLS_StyleScopedClasses['mt-4']} */ ;
/** @type {__VLS_StyleScopedClasses['mt-4']} */ ;
/** @type {__VLS_StyleScopedClasses['ml-2']} */ ;
var __VLS_dollars;
const __VLS_self = (await Promise.resolve().then(() => __importStar(require('vue')))).defineComponent({
    setup() {
        return {
            effortOptions: effortOptions,
            formData: formData,
            errors: errors,
            submitting: submitting,
            submitError: submitError,
            submitSuccess: submitSuccess,
            handleSubmit: handleSubmit,
            resetForm: resetForm,
        };
    },
});
exports.default = (await Promise.resolve().then(() => __importStar(require('vue')))).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
//# sourceMappingURL=SubmitIdeaPage.vue.js.map