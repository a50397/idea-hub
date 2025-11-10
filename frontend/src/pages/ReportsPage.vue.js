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
const vue_1 = require("vue");
const vue_router_1 = require("vue-router");
const reports_1 = require("../api/reports");
const types_1 = require("../types");
const router = (0, vue_router_1.useRouter)();
const loading = (0, vue_1.ref)(false);
const exporting = (0, vue_1.ref)(false);
const ideas = (0, vue_1.ref)([]);
const snackbar = (0, vue_1.ref)(false);
const snackbarText = (0, vue_1.ref)('');
const snackbarColor = (0, vue_1.ref)('success');
const filters = (0, vue_1.reactive)({
    status: null,
    startDate: '',
    endDate: '',
});
const statusOptions = Object.values(types_1.IdeaStatus).map((status) => ({
    title: types_1.statusLabels[status],
    value: status,
}));
const headers = [
    { title: 'Title', key: 'title', sortable: true },
    { title: 'Status', key: 'status', sortable: true },
    { title: 'Effort', key: 'effort', sortable: true },
    { title: 'Submitter', key: 'submitter', sortable: true },
    { title: 'Assignee', key: 'assignee', sortable: true },
    { title: 'Submitted', key: 'submittedAt', sortable: true },
    { title: 'Duration (days)', key: 'duration', sortable: true },
];
async function applyFilters() {
    loading.value = true;
    try {
        const filterParams = {};
        if (filters.status)
            filterParams.status = filters.status;
        if (filters.startDate)
            filterParams.startDate = filters.startDate;
        if (filters.endDate)
            filterParams.endDate = filters.endDate;
        ideas.value = await reports_1.reportsApi.getFiltered(filterParams);
    }
    catch (error) {
        console.error('Error applying filters:', error);
        snackbarText.value = 'Failed to load filtered data';
        snackbarColor.value = 'error';
        snackbar.value = true;
    }
    finally {
        loading.value = false;
    }
}
function resetFilters() {
    filters.status = null;
    filters.startDate = '';
    filters.endDate = '';
    applyFilters();
}
async function exportCSV() {
    exporting.value = true;
    try {
        const filterParams = {};
        if (filters.status)
            filterParams.status = filters.status;
        if (filters.startDate)
            filterParams.startDate = filters.startDate;
        if (filters.endDate)
            filterParams.endDate = filters.endDate;
        const blob = await reports_1.reportsApi.exportCSV(filterParams);
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `ideas-report-${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
        window.URL.revokeObjectURL(url);
        snackbarText.value = 'Report exported successfully!';
        snackbarColor.value = 'success';
        snackbar.value = true;
    }
    catch (error) {
        console.error('Error exporting CSV:', error);
        snackbarText.value = 'Failed to export report';
        snackbarColor.value = 'error';
        snackbar.value = true;
    }
    finally {
        exporting.value = false;
    }
}
function viewIdea(id) {
    router.push({ name: 'IdeaDetail', params: { id } });
}
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
}
function calculateDuration(idea) {
    if (!idea.completedAt || !idea.submittedAt)
        return '-';
    const start = new Date(idea.submittedAt);
    const end = new Date(idea.completedAt);
    const days = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    return `${days}`;
}
(0, vue_1.onMounted)(() => {
    applyFilters();
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
const __VLS_5 = {}.VCard;
/** @type {[typeof __VLS_components.VCard, typeof __VLS_components.vCard, typeof __VLS_components.VCard, typeof __VLS_components.vCard, ]} */ ;
// @ts-ignore
const __VLS_6 = __VLS_asFunctionalComponent(__VLS_5, new __VLS_5({
    ...{ class: "mb-4" },
}));
const __VLS_7 = __VLS_6({
    ...{ class: "mb-4" },
}, ...__VLS_functionalComponentArgsRest(__VLS_6));
__VLS_8.slots.default;
const __VLS_9 = {}.VCardTitle;
/** @type {[typeof __VLS_components.VCardTitle, typeof __VLS_components.vCardTitle, typeof __VLS_components.VCardTitle, typeof __VLS_components.vCardTitle, ]} */ ;
// @ts-ignore
const __VLS_10 = __VLS_asFunctionalComponent(__VLS_9, new __VLS_9({}));
const __VLS_11 = __VLS_10({}, ...__VLS_functionalComponentArgsRest(__VLS_10));
__VLS_12.slots.default;
var __VLS_12;
const __VLS_13 = {}.VCardText;
/** @type {[typeof __VLS_components.VCardText, typeof __VLS_components.vCardText, typeof __VLS_components.VCardText, typeof __VLS_components.vCardText, ]} */ ;
// @ts-ignore
const __VLS_14 = __VLS_asFunctionalComponent(__VLS_13, new __VLS_13({}));
const __VLS_15 = __VLS_14({}, ...__VLS_functionalComponentArgsRest(__VLS_14));
__VLS_16.slots.default;
const __VLS_17 = {}.VRow;
/** @type {[typeof __VLS_components.VRow, typeof __VLS_components.vRow, typeof __VLS_components.VRow, typeof __VLS_components.vRow, ]} */ ;
// @ts-ignore
const __VLS_18 = __VLS_asFunctionalComponent(__VLS_17, new __VLS_17({}));
const __VLS_19 = __VLS_18({}, ...__VLS_functionalComponentArgsRest(__VLS_18));
__VLS_20.slots.default;
const __VLS_21 = {}.VCol;
/** @type {[typeof __VLS_components.VCol, typeof __VLS_components.vCol, typeof __VLS_components.VCol, typeof __VLS_components.vCol, ]} */ ;
// @ts-ignore
const __VLS_22 = __VLS_asFunctionalComponent(__VLS_21, new __VLS_21({
    cols: "12",
    md: "3",
}));
const __VLS_23 = __VLS_22({
    cols: "12",
    md: "3",
}, ...__VLS_functionalComponentArgsRest(__VLS_22));
__VLS_24.slots.default;
const __VLS_25 = {}.VSelect;
/** @type {[typeof __VLS_components.VSelect, typeof __VLS_components.vSelect, typeof __VLS_components.VSelect, typeof __VLS_components.vSelect, ]} */ ;
// @ts-ignore
const __VLS_26 = __VLS_asFunctionalComponent(__VLS_25, new __VLS_25({
    modelValue: (__VLS_ctx.filters.status),
    label: "Status",
    items: (__VLS_ctx.statusOptions),
    clearable: true,
    variant: "outlined",
    density: "compact",
}));
const __VLS_27 = __VLS_26({
    modelValue: (__VLS_ctx.filters.status),
    label: "Status",
    items: (__VLS_ctx.statusOptions),
    clearable: true,
    variant: "outlined",
    density: "compact",
}, ...__VLS_functionalComponentArgsRest(__VLS_26));
var __VLS_24;
const __VLS_29 = {}.VCol;
/** @type {[typeof __VLS_components.VCol, typeof __VLS_components.vCol, typeof __VLS_components.VCol, typeof __VLS_components.vCol, ]} */ ;
// @ts-ignore
const __VLS_30 = __VLS_asFunctionalComponent(__VLS_29, new __VLS_29({
    cols: "12",
    md: "3",
}));
const __VLS_31 = __VLS_30({
    cols: "12",
    md: "3",
}, ...__VLS_functionalComponentArgsRest(__VLS_30));
__VLS_32.slots.default;
const __VLS_33 = {}.VTextField;
/** @type {[typeof __VLS_components.VTextField, typeof __VLS_components.vTextField, typeof __VLS_components.VTextField, typeof __VLS_components.vTextField, ]} */ ;
// @ts-ignore
const __VLS_34 = __VLS_asFunctionalComponent(__VLS_33, new __VLS_33({
    modelValue: (__VLS_ctx.filters.startDate),
    label: "Start Date",
    type: "date",
    variant: "outlined",
    density: "compact",
}));
const __VLS_35 = __VLS_34({
    modelValue: (__VLS_ctx.filters.startDate),
    label: "Start Date",
    type: "date",
    variant: "outlined",
    density: "compact",
}, ...__VLS_functionalComponentArgsRest(__VLS_34));
var __VLS_32;
const __VLS_37 = {}.VCol;
/** @type {[typeof __VLS_components.VCol, typeof __VLS_components.vCol, typeof __VLS_components.VCol, typeof __VLS_components.vCol, ]} */ ;
// @ts-ignore
const __VLS_38 = __VLS_asFunctionalComponent(__VLS_37, new __VLS_37({
    cols: "12",
    md: "3",
}));
const __VLS_39 = __VLS_38({
    cols: "12",
    md: "3",
}, ...__VLS_functionalComponentArgsRest(__VLS_38));
__VLS_40.slots.default;
const __VLS_41 = {}.VTextField;
/** @type {[typeof __VLS_components.VTextField, typeof __VLS_components.vTextField, typeof __VLS_components.VTextField, typeof __VLS_components.vTextField, ]} */ ;
// @ts-ignore
const __VLS_42 = __VLS_asFunctionalComponent(__VLS_41, new __VLS_41({
    modelValue: (__VLS_ctx.filters.endDate),
    label: "End Date",
    type: "date",
    variant: "outlined",
    density: "compact",
}));
const __VLS_43 = __VLS_42({
    modelValue: (__VLS_ctx.filters.endDate),
    label: "End Date",
    type: "date",
    variant: "outlined",
    density: "compact",
}, ...__VLS_functionalComponentArgsRest(__VLS_42));
var __VLS_40;
const __VLS_45 = {}.VCol;
/** @type {[typeof __VLS_components.VCol, typeof __VLS_components.vCol, typeof __VLS_components.VCol, typeof __VLS_components.vCol, ]} */ ;
// @ts-ignore
const __VLS_46 = __VLS_asFunctionalComponent(__VLS_45, new __VLS_45({
    cols: "12",
    md: "3",
    ...{ class: "d-flex align-center" },
}));
const __VLS_47 = __VLS_46({
    cols: "12",
    md: "3",
    ...{ class: "d-flex align-center" },
}, ...__VLS_functionalComponentArgsRest(__VLS_46));
__VLS_48.slots.default;
const __VLS_49 = {}.VBtn;
/** @type {[typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, ]} */ ;
// @ts-ignore
const __VLS_50 = __VLS_asFunctionalComponent(__VLS_49, new __VLS_49({
    ...{ 'onClick': {} },
    color: "primary",
    ...{ class: "mr-2" },
}));
const __VLS_51 = __VLS_50({
    ...{ 'onClick': {} },
    color: "primary",
    ...{ class: "mr-2" },
}, ...__VLS_functionalComponentArgsRest(__VLS_50));
let __VLS_53;
let __VLS_54;
let __VLS_55;
const __VLS_56 = {
    onClick: (__VLS_ctx.applyFilters)
};
__VLS_52.slots.default;
var __VLS_52;
const __VLS_57 = {}.VBtn;
/** @type {[typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, ]} */ ;
// @ts-ignore
const __VLS_58 = __VLS_asFunctionalComponent(__VLS_57, new __VLS_57({
    ...{ 'onClick': {} },
    variant: "outlined",
}));
const __VLS_59 = __VLS_58({
    ...{ 'onClick': {} },
    variant: "outlined",
}, ...__VLS_functionalComponentArgsRest(__VLS_58));
let __VLS_61;
let __VLS_62;
let __VLS_63;
const __VLS_64 = {
    onClick: (__VLS_ctx.resetFilters)
};
__VLS_60.slots.default;
var __VLS_60;
var __VLS_48;
var __VLS_20;
var __VLS_16;
var __VLS_8;
const __VLS_65 = {}.VRow;
/** @type {[typeof __VLS_components.VRow, typeof __VLS_components.vRow, typeof __VLS_components.VRow, typeof __VLS_components.vRow, ]} */ ;
// @ts-ignore
const __VLS_66 = __VLS_asFunctionalComponent(__VLS_65, new __VLS_65({}));
const __VLS_67 = __VLS_66({}, ...__VLS_functionalComponentArgsRest(__VLS_66));
__VLS_68.slots.default;
const __VLS_69 = {}.VCol;
/** @type {[typeof __VLS_components.VCol, typeof __VLS_components.vCol, typeof __VLS_components.VCol, typeof __VLS_components.vCol, ]} */ ;
// @ts-ignore
const __VLS_70 = __VLS_asFunctionalComponent(__VLS_69, new __VLS_69({
    cols: "12",
}));
const __VLS_71 = __VLS_70({
    cols: "12",
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
const __VLS_78 = __VLS_asFunctionalComponent(__VLS_77, new __VLS_77({
    ...{ class: "d-flex align-center" },
}));
const __VLS_79 = __VLS_78({
    ...{ class: "d-flex align-center" },
}, ...__VLS_functionalComponentArgsRest(__VLS_78));
__VLS_80.slots.default;
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "flex-grow-1" },
});
(__VLS_ctx.ideas.length);
const __VLS_81 = {}.VBtn;
/** @type {[typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, ]} */ ;
// @ts-ignore
const __VLS_82 = __VLS_asFunctionalComponent(__VLS_81, new __VLS_81({
    ...{ 'onClick': {} },
    color: "success",
    prependIcon: "mdi-download",
    loading: (__VLS_ctx.exporting),
}));
const __VLS_83 = __VLS_82({
    ...{ 'onClick': {} },
    color: "success",
    prependIcon: "mdi-download",
    loading: (__VLS_ctx.exporting),
}, ...__VLS_functionalComponentArgsRest(__VLS_82));
let __VLS_85;
let __VLS_86;
let __VLS_87;
const __VLS_88 = {
    onClick: (__VLS_ctx.exportCSV)
};
__VLS_84.slots.default;
var __VLS_84;
var __VLS_80;
const __VLS_89 = {}.VCardText;
/** @type {[typeof __VLS_components.VCardText, typeof __VLS_components.vCardText, typeof __VLS_components.VCardText, typeof __VLS_components.vCardText, ]} */ ;
// @ts-ignore
const __VLS_90 = __VLS_asFunctionalComponent(__VLS_89, new __VLS_89({}));
const __VLS_91 = __VLS_90({}, ...__VLS_functionalComponentArgsRest(__VLS_90));
__VLS_92.slots.default;
const __VLS_93 = {}.VDataTable;
/** @type {[typeof __VLS_components.VDataTable, typeof __VLS_components.vDataTable, typeof __VLS_components.VDataTable, typeof __VLS_components.vDataTable, ]} */ ;
// @ts-ignore
const __VLS_94 = __VLS_asFunctionalComponent(__VLS_93, new __VLS_93({
    headers: (__VLS_ctx.headers),
    items: (__VLS_ctx.ideas),
    loading: (__VLS_ctx.loading),
    itemValue: "id",
}));
const __VLS_95 = __VLS_94({
    headers: (__VLS_ctx.headers),
    items: (__VLS_ctx.ideas),
    loading: (__VLS_ctx.loading),
    itemValue: "id",
}, ...__VLS_functionalComponentArgsRest(__VLS_94));
__VLS_96.slots.default;
{
    const { 'item.title': __VLS_thisSlot } = __VLS_96.slots;
    const [{ item }] = __VLS_getSlotParams(__VLS_thisSlot);
    const __VLS_97 = {}.VBtn;
    /** @type {[typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, ]} */ ;
    // @ts-ignore
    const __VLS_98 = __VLS_asFunctionalComponent(__VLS_97, new __VLS_97({
        ...{ 'onClick': {} },
        variant: "text",
        ...{ class: "text-none" },
    }));
    const __VLS_99 = __VLS_98({
        ...{ 'onClick': {} },
        variant: "text",
        ...{ class: "text-none" },
    }, ...__VLS_functionalComponentArgsRest(__VLS_98));
    let __VLS_101;
    let __VLS_102;
    let __VLS_103;
    const __VLS_104 = {
        onClick: (...[$event]) => {
            __VLS_ctx.viewIdea(item.id);
        }
    };
    __VLS_100.slots.default;
    (item.title);
    var __VLS_100;
}
{
    const { 'item.status': __VLS_thisSlot } = __VLS_96.slots;
    const [{ item }] = __VLS_getSlotParams(__VLS_thisSlot);
    const __VLS_105 = {}.VChip;
    /** @type {[typeof __VLS_components.VChip, typeof __VLS_components.vChip, typeof __VLS_components.VChip, typeof __VLS_components.vChip, ]} */ ;
    // @ts-ignore
    const __VLS_106 = __VLS_asFunctionalComponent(__VLS_105, new __VLS_105({
        color: (__VLS_ctx.statusColors[item.status]),
        size: "small",
    }));
    const __VLS_107 = __VLS_106({
        color: (__VLS_ctx.statusColors[item.status]),
        size: "small",
    }, ...__VLS_functionalComponentArgsRest(__VLS_106));
    __VLS_108.slots.default;
    (__VLS_ctx.statusLabels[item.status]);
    var __VLS_108;
}
{
    const { 'item.effort': __VLS_thisSlot } = __VLS_96.slots;
    const [{ item }] = __VLS_getSlotParams(__VLS_thisSlot);
    const __VLS_109 = {}.VChip;
    /** @type {[typeof __VLS_components.VChip, typeof __VLS_components.vChip, typeof __VLS_components.VChip, typeof __VLS_components.vChip, ]} */ ;
    // @ts-ignore
    const __VLS_110 = __VLS_asFunctionalComponent(__VLS_109, new __VLS_109({
        size: "small",
        variant: "outlined",
    }));
    const __VLS_111 = __VLS_110({
        size: "small",
        variant: "outlined",
    }, ...__VLS_functionalComponentArgsRest(__VLS_110));
    __VLS_112.slots.default;
    (__VLS_ctx.effortLabels[item.effort]);
    var __VLS_112;
}
{
    const { 'item.submitter': __VLS_thisSlot } = __VLS_96.slots;
    const [{ item }] = __VLS_getSlotParams(__VLS_thisSlot);
    (item.submitter.name);
}
{
    const { 'item.assignee': __VLS_thisSlot } = __VLS_96.slots;
    const [{ item }] = __VLS_getSlotParams(__VLS_thisSlot);
    (item.assignee?.name || '-');
}
{
    const { 'item.submittedAt': __VLS_thisSlot } = __VLS_96.slots;
    const [{ item }] = __VLS_getSlotParams(__VLS_thisSlot);
    (__VLS_ctx.formatDate(item.submittedAt));
}
{
    const { 'item.duration': __VLS_thisSlot } = __VLS_96.slots;
    const [{ item }] = __VLS_getSlotParams(__VLS_thisSlot);
    (__VLS_ctx.calculateDuration(item));
}
var __VLS_96;
var __VLS_92;
var __VLS_76;
var __VLS_72;
var __VLS_68;
const __VLS_113 = {}.VSnackbar;
/** @type {[typeof __VLS_components.VSnackbar, typeof __VLS_components.vSnackbar, typeof __VLS_components.VSnackbar, typeof __VLS_components.vSnackbar, ]} */ ;
// @ts-ignore
const __VLS_114 = __VLS_asFunctionalComponent(__VLS_113, new __VLS_113({
    modelValue: (__VLS_ctx.snackbar),
    color: (__VLS_ctx.snackbarColor),
}));
const __VLS_115 = __VLS_114({
    modelValue: (__VLS_ctx.snackbar),
    color: (__VLS_ctx.snackbarColor),
}, ...__VLS_functionalComponentArgsRest(__VLS_114));
__VLS_116.slots.default;
(__VLS_ctx.snackbarText);
var __VLS_116;
var __VLS_3;
/** @type {__VLS_StyleScopedClasses['page-container']} */ ;
/** @type {__VLS_StyleScopedClasses['text-h4']} */ ;
/** @type {__VLS_StyleScopedClasses['page-title']} */ ;
/** @type {__VLS_StyleScopedClasses['mb-4']} */ ;
/** @type {__VLS_StyleScopedClasses['d-flex']} */ ;
/** @type {__VLS_StyleScopedClasses['align-center']} */ ;
/** @type {__VLS_StyleScopedClasses['mr-2']} */ ;
/** @type {__VLS_StyleScopedClasses['d-flex']} */ ;
/** @type {__VLS_StyleScopedClasses['align-center']} */ ;
/** @type {__VLS_StyleScopedClasses['flex-grow-1']} */ ;
/** @type {__VLS_StyleScopedClasses['text-none']} */ ;
var __VLS_dollars;
const __VLS_self = (await Promise.resolve().then(() => __importStar(require('vue')))).defineComponent({
    setup() {
        return {
            statusLabels: types_1.statusLabels,
            statusColors: types_1.statusColors,
            effortLabels: types_1.effortLabels,
            loading: loading,
            exporting: exporting,
            ideas: ideas,
            snackbar: snackbar,
            snackbarText: snackbarText,
            snackbarColor: snackbarColor,
            filters: filters,
            statusOptions: statusOptions,
            headers: headers,
            applyFilters: applyFilters,
            resetFilters: resetFilters,
            exportCSV: exportCSV,
            viewIdea: viewIdea,
            formatDate: formatDate,
            calculateDuration: calculateDuration,
        };
    },
});
exports.default = (await Promise.resolve().then(() => __importStar(require('vue')))).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
//# sourceMappingURL=ReportsPage.vue.js.map