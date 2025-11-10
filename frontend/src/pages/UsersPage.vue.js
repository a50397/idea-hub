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
const users_1 = require("../api/users");
const types_1 = require("../types");
const loading = (0, vue_1.ref)(false);
const saving = (0, vue_1.ref)(false);
const deleting = (0, vue_1.ref)(false);
const users = (0, vue_1.ref)([]);
const createDialog = (0, vue_1.ref)(false);
const editDialog = (0, vue_1.ref)(false);
const deleteDialog = (0, vue_1.ref)(false);
const selectedUser = (0, vue_1.ref)(null);
const snackbar = (0, vue_1.ref)(false);
const snackbarText = (0, vue_1.ref)('');
const snackbarColor = (0, vue_1.ref)('success');
const formData = (0, vue_1.reactive)({
    name: '',
    email: '',
    password: '',
    role: types_1.Role.USER,
});
const formErrors = (0, vue_1.reactive)({
    name: [],
    email: [],
    password: [],
});
const roleOptions = [
    { title: 'User', value: types_1.Role.USER },
    { title: 'Power User', value: types_1.Role.POWER_USER },
    { title: 'Admin', value: types_1.Role.ADMIN },
];
const headers = [
    { title: 'Name', key: 'name', sortable: true },
    { title: 'Email', key: 'email', sortable: true },
    { title: 'Role', key: 'role', sortable: true },
    { title: 'Stats', key: 'stats', sortable: false },
    { title: 'Actions', key: 'actions', sortable: false },
];
async function loadUsers() {
    loading.value = true;
    try {
        users.value = await users_1.usersApi.getAll();
    }
    catch (error) {
        console.error('Error loading users:', error);
    }
    finally {
        loading.value = false;
    }
}
function showCreateDialog() {
    resetForm();
    createDialog.value = true;
}
function showEditDialog(user) {
    selectedUser.value = user;
    formData.name = user.name;
    formData.email = user.email;
    formData.password = '';
    formData.role = user.role;
    resetErrors();
    editDialog.value = true;
}
function showDeleteDialog(user) {
    selectedUser.value = user;
    deleteDialog.value = true;
}
function validateForm(isCreate) {
    resetErrors();
    let valid = true;
    if (!formData.name) {
        formErrors.name.push('Name is required');
        valid = false;
    }
    if (!formData.email) {
        formErrors.email.push('Email is required');
        valid = false;
    }
    if (isCreate && !formData.password) {
        formErrors.password.push('Password is required');
        valid = false;
    }
    if (formData.password && formData.password.length < 6) {
        formErrors.password.push('Password must be at least 6 characters');
        valid = false;
    }
    return valid;
}
async function createUser() {
    if (!validateForm(true))
        return;
    saving.value = true;
    try {
        await users_1.usersApi.create({
            name: formData.name,
            email: formData.email,
            password: formData.password,
            role: formData.role,
        });
        snackbarText.value = 'User created successfully!';
        snackbarColor.value = 'success';
        snackbar.value = true;
        createDialog.value = false;
        await loadUsers();
    }
    catch (error) {
        snackbarText.value = error.response?.data?.error || 'Failed to create user';
        snackbarColor.value = 'error';
        snackbar.value = true;
    }
    finally {
        saving.value = false;
    }
}
async function updateUser() {
    if (!selectedUser.value)
        return;
    if (!validateForm(false))
        return;
    saving.value = true;
    try {
        const updateData = {
            name: formData.name,
            email: formData.email,
            role: formData.role,
        };
        if (formData.password) {
            updateData.password = formData.password;
        }
        await users_1.usersApi.update(selectedUser.value.id, updateData);
        snackbarText.value = 'User updated successfully!';
        snackbarColor.value = 'success';
        snackbar.value = true;
        editDialog.value = false;
        await loadUsers();
    }
    catch (error) {
        snackbarText.value = error.response?.data?.error || 'Failed to update user';
        snackbarColor.value = 'error';
        snackbar.value = true;
    }
    finally {
        saving.value = false;
    }
}
async function deleteUser() {
    if (!selectedUser.value)
        return;
    deleting.value = true;
    try {
        await users_1.usersApi.delete(selectedUser.value.id);
        snackbarText.value = 'User deleted successfully';
        snackbarColor.value = 'success';
        snackbar.value = true;
        deleteDialog.value = false;
        await loadUsers();
    }
    catch (error) {
        snackbarText.value = error.response?.data?.error || 'Failed to delete user';
        snackbarColor.value = 'error';
        snackbar.value = true;
    }
    finally {
        deleting.value = false;
    }
}
function resetForm() {
    formData.name = '';
    formData.email = '';
    formData.password = '';
    formData.role = types_1.Role.USER;
    resetErrors();
}
function resetErrors() {
    formErrors.name = [];
    formErrors.email = [];
    formErrors.password = [];
}
function getRoleColor(role) {
    switch (role) {
        case types_1.Role.ADMIN:
            return 'error';
        case types_1.Role.POWER_USER:
            return 'warning';
        default:
            return 'info';
    }
}
(0, vue_1.onMounted)(() => {
    loadUsers();
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
const __VLS_6 = __VLS_asFunctionalComponent(__VLS_5, new __VLS_5({}));
const __VLS_7 = __VLS_6({}, ...__VLS_functionalComponentArgsRest(__VLS_6));
__VLS_8.slots.default;
const __VLS_9 = {}.VCardTitle;
/** @type {[typeof __VLS_components.VCardTitle, typeof __VLS_components.vCardTitle, typeof __VLS_components.VCardTitle, typeof __VLS_components.vCardTitle, ]} */ ;
// @ts-ignore
const __VLS_10 = __VLS_asFunctionalComponent(__VLS_9, new __VLS_9({
    ...{ class: "d-flex align-center" },
}));
const __VLS_11 = __VLS_10({
    ...{ class: "d-flex align-center" },
}, ...__VLS_functionalComponentArgsRest(__VLS_10));
__VLS_12.slots.default;
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "flex-grow-1" },
});
const __VLS_13 = {}.VBtn;
/** @type {[typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, ]} */ ;
// @ts-ignore
const __VLS_14 = __VLS_asFunctionalComponent(__VLS_13, new __VLS_13({
    ...{ 'onClick': {} },
    color: "primary",
    prependIcon: "mdi-plus",
}));
const __VLS_15 = __VLS_14({
    ...{ 'onClick': {} },
    color: "primary",
    prependIcon: "mdi-plus",
}, ...__VLS_functionalComponentArgsRest(__VLS_14));
let __VLS_17;
let __VLS_18;
let __VLS_19;
const __VLS_20 = {
    onClick: (__VLS_ctx.showCreateDialog)
};
__VLS_16.slots.default;
var __VLS_16;
var __VLS_12;
const __VLS_21 = {}.VCardText;
/** @type {[typeof __VLS_components.VCardText, typeof __VLS_components.vCardText, typeof __VLS_components.VCardText, typeof __VLS_components.vCardText, ]} */ ;
// @ts-ignore
const __VLS_22 = __VLS_asFunctionalComponent(__VLS_21, new __VLS_21({}));
const __VLS_23 = __VLS_22({}, ...__VLS_functionalComponentArgsRest(__VLS_22));
__VLS_24.slots.default;
const __VLS_25 = {}.VDataTable;
/** @type {[typeof __VLS_components.VDataTable, typeof __VLS_components.vDataTable, typeof __VLS_components.VDataTable, typeof __VLS_components.vDataTable, ]} */ ;
// @ts-ignore
const __VLS_26 = __VLS_asFunctionalComponent(__VLS_25, new __VLS_25({
    headers: (__VLS_ctx.headers),
    items: (__VLS_ctx.users),
    loading: (__VLS_ctx.loading),
    itemValue: "id",
}));
const __VLS_27 = __VLS_26({
    headers: (__VLS_ctx.headers),
    items: (__VLS_ctx.users),
    loading: (__VLS_ctx.loading),
    itemValue: "id",
}, ...__VLS_functionalComponentArgsRest(__VLS_26));
__VLS_28.slots.default;
{
    const { 'item.name': __VLS_thisSlot } = __VLS_28.slots;
    const [{ item }] = __VLS_getSlotParams(__VLS_thisSlot);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "d-flex align-center" },
    });
    const __VLS_29 = {}.VAvatar;
    /** @type {[typeof __VLS_components.VAvatar, typeof __VLS_components.vAvatar, typeof __VLS_components.VAvatar, typeof __VLS_components.vAvatar, ]} */ ;
    // @ts-ignore
    const __VLS_30 = __VLS_asFunctionalComponent(__VLS_29, new __VLS_29({
        image: (`https://ui-avatars.com/api/?name=${item.name}&background=1976D2&color=fff`),
        size: "32",
        ...{ class: "mr-2" },
    }));
    const __VLS_31 = __VLS_30({
        image: (`https://ui-avatars.com/api/?name=${item.name}&background=1976D2&color=fff`),
        size: "32",
        ...{ class: "mr-2" },
    }, ...__VLS_functionalComponentArgsRest(__VLS_30));
    (item.name);
}
{
    const { 'item.role': __VLS_thisSlot } = __VLS_28.slots;
    const [{ item }] = __VLS_getSlotParams(__VLS_thisSlot);
    const __VLS_33 = {}.VChip;
    /** @type {[typeof __VLS_components.VChip, typeof __VLS_components.vChip, typeof __VLS_components.VChip, typeof __VLS_components.vChip, ]} */ ;
    // @ts-ignore
    const __VLS_34 = __VLS_asFunctionalComponent(__VLS_33, new __VLS_33({
        color: (__VLS_ctx.getRoleColor(item.role)),
        size: "small",
    }));
    const __VLS_35 = __VLS_34({
        color: (__VLS_ctx.getRoleColor(item.role)),
        size: "small",
    }, ...__VLS_functionalComponentArgsRest(__VLS_34));
    __VLS_36.slots.default;
    (item.role);
    var __VLS_36;
}
{
    const { 'item.stats': __VLS_thisSlot } = __VLS_28.slots;
    const [{ item }] = __VLS_getSlotParams(__VLS_thisSlot);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "text-caption" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
    (item._count?.submittedIdeas || 0);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
    (item._count?.assignedIdeas || 0);
}
{
    const { 'item.actions': __VLS_thisSlot } = __VLS_28.slots;
    const [{ item }] = __VLS_getSlotParams(__VLS_thisSlot);
    const __VLS_37 = {}.VBtn;
    /** @type {[typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, ]} */ ;
    // @ts-ignore
    const __VLS_38 = __VLS_asFunctionalComponent(__VLS_37, new __VLS_37({
        ...{ 'onClick': {} },
        icon: "mdi-pencil",
        size: "small",
        variant: "text",
    }));
    const __VLS_39 = __VLS_38({
        ...{ 'onClick': {} },
        icon: "mdi-pencil",
        size: "small",
        variant: "text",
    }, ...__VLS_functionalComponentArgsRest(__VLS_38));
    let __VLS_41;
    let __VLS_42;
    let __VLS_43;
    const __VLS_44 = {
        onClick: (...[$event]) => {
            __VLS_ctx.showEditDialog(item);
        }
    };
    var __VLS_40;
    const __VLS_45 = {}.VBtn;
    /** @type {[typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, ]} */ ;
    // @ts-ignore
    const __VLS_46 = __VLS_asFunctionalComponent(__VLS_45, new __VLS_45({
        ...{ 'onClick': {} },
        icon: "mdi-delete",
        size: "small",
        variant: "text",
        color: "error",
    }));
    const __VLS_47 = __VLS_46({
        ...{ 'onClick': {} },
        icon: "mdi-delete",
        size: "small",
        variant: "text",
        color: "error",
    }, ...__VLS_functionalComponentArgsRest(__VLS_46));
    let __VLS_49;
    let __VLS_50;
    let __VLS_51;
    const __VLS_52 = {
        onClick: (...[$event]) => {
            __VLS_ctx.showDeleteDialog(item);
        }
    };
    var __VLS_48;
}
var __VLS_28;
var __VLS_24;
var __VLS_8;
const __VLS_53 = {}.VDialog;
/** @type {[typeof __VLS_components.VDialog, typeof __VLS_components.vDialog, typeof __VLS_components.VDialog, typeof __VLS_components.vDialog, ]} */ ;
// @ts-ignore
const __VLS_54 = __VLS_asFunctionalComponent(__VLS_53, new __VLS_53({
    modelValue: (__VLS_ctx.createDialog),
    maxWidth: "500",
}));
const __VLS_55 = __VLS_54({
    modelValue: (__VLS_ctx.createDialog),
    maxWidth: "500",
}, ...__VLS_functionalComponentArgsRest(__VLS_54));
__VLS_56.slots.default;
const __VLS_57 = {}.VCard;
/** @type {[typeof __VLS_components.VCard, typeof __VLS_components.vCard, typeof __VLS_components.VCard, typeof __VLS_components.vCard, ]} */ ;
// @ts-ignore
const __VLS_58 = __VLS_asFunctionalComponent(__VLS_57, new __VLS_57({}));
const __VLS_59 = __VLS_58({}, ...__VLS_functionalComponentArgsRest(__VLS_58));
__VLS_60.slots.default;
const __VLS_61 = {}.VCardTitle;
/** @type {[typeof __VLS_components.VCardTitle, typeof __VLS_components.vCardTitle, typeof __VLS_components.VCardTitle, typeof __VLS_components.vCardTitle, ]} */ ;
// @ts-ignore
const __VLS_62 = __VLS_asFunctionalComponent(__VLS_61, new __VLS_61({}));
const __VLS_63 = __VLS_62({}, ...__VLS_functionalComponentArgsRest(__VLS_62));
__VLS_64.slots.default;
var __VLS_64;
const __VLS_65 = {}.VCardText;
/** @type {[typeof __VLS_components.VCardText, typeof __VLS_components.vCardText, typeof __VLS_components.VCardText, typeof __VLS_components.vCardText, ]} */ ;
// @ts-ignore
const __VLS_66 = __VLS_asFunctionalComponent(__VLS_65, new __VLS_65({}));
const __VLS_67 = __VLS_66({}, ...__VLS_functionalComponentArgsRest(__VLS_66));
__VLS_68.slots.default;
const __VLS_69 = {}.VForm;
/** @type {[typeof __VLS_components.VForm, typeof __VLS_components.vForm, typeof __VLS_components.VForm, typeof __VLS_components.vForm, ]} */ ;
// @ts-ignore
const __VLS_70 = __VLS_asFunctionalComponent(__VLS_69, new __VLS_69({}));
const __VLS_71 = __VLS_70({}, ...__VLS_functionalComponentArgsRest(__VLS_70));
__VLS_72.slots.default;
const __VLS_73 = {}.VTextField;
/** @type {[typeof __VLS_components.VTextField, typeof __VLS_components.vTextField, typeof __VLS_components.VTextField, typeof __VLS_components.vTextField, ]} */ ;
// @ts-ignore
const __VLS_74 = __VLS_asFunctionalComponent(__VLS_73, new __VLS_73({
    modelValue: (__VLS_ctx.formData.name),
    label: "Name *",
    variant: "outlined",
    errorMessages: (__VLS_ctx.formErrors.name),
}));
const __VLS_75 = __VLS_74({
    modelValue: (__VLS_ctx.formData.name),
    label: "Name *",
    variant: "outlined",
    errorMessages: (__VLS_ctx.formErrors.name),
}, ...__VLS_functionalComponentArgsRest(__VLS_74));
const __VLS_77 = {}.VTextField;
/** @type {[typeof __VLS_components.VTextField, typeof __VLS_components.vTextField, typeof __VLS_components.VTextField, typeof __VLS_components.vTextField, ]} */ ;
// @ts-ignore
const __VLS_78 = __VLS_asFunctionalComponent(__VLS_77, new __VLS_77({
    modelValue: (__VLS_ctx.formData.email),
    label: "Email *",
    type: "email",
    variant: "outlined",
    errorMessages: (__VLS_ctx.formErrors.email),
}));
const __VLS_79 = __VLS_78({
    modelValue: (__VLS_ctx.formData.email),
    label: "Email *",
    type: "email",
    variant: "outlined",
    errorMessages: (__VLS_ctx.formErrors.email),
}, ...__VLS_functionalComponentArgsRest(__VLS_78));
const __VLS_81 = {}.VTextField;
/** @type {[typeof __VLS_components.VTextField, typeof __VLS_components.vTextField, typeof __VLS_components.VTextField, typeof __VLS_components.vTextField, ]} */ ;
// @ts-ignore
const __VLS_82 = __VLS_asFunctionalComponent(__VLS_81, new __VLS_81({
    modelValue: (__VLS_ctx.formData.password),
    label: "Password *",
    type: "password",
    variant: "outlined",
    errorMessages: (__VLS_ctx.formErrors.password),
}));
const __VLS_83 = __VLS_82({
    modelValue: (__VLS_ctx.formData.password),
    label: "Password *",
    type: "password",
    variant: "outlined",
    errorMessages: (__VLS_ctx.formErrors.password),
}, ...__VLS_functionalComponentArgsRest(__VLS_82));
const __VLS_85 = {}.VSelect;
/** @type {[typeof __VLS_components.VSelect, typeof __VLS_components.vSelect, typeof __VLS_components.VSelect, typeof __VLS_components.vSelect, ]} */ ;
// @ts-ignore
const __VLS_86 = __VLS_asFunctionalComponent(__VLS_85, new __VLS_85({
    modelValue: (__VLS_ctx.formData.role),
    label: "Role *",
    items: (__VLS_ctx.roleOptions),
    variant: "outlined",
}));
const __VLS_87 = __VLS_86({
    modelValue: (__VLS_ctx.formData.role),
    label: "Role *",
    items: (__VLS_ctx.roleOptions),
    variant: "outlined",
}, ...__VLS_functionalComponentArgsRest(__VLS_86));
var __VLS_72;
var __VLS_68;
const __VLS_89 = {}.VCardActions;
/** @type {[typeof __VLS_components.VCardActions, typeof __VLS_components.vCardActions, typeof __VLS_components.VCardActions, typeof __VLS_components.vCardActions, ]} */ ;
// @ts-ignore
const __VLS_90 = __VLS_asFunctionalComponent(__VLS_89, new __VLS_89({}));
const __VLS_91 = __VLS_90({}, ...__VLS_functionalComponentArgsRest(__VLS_90));
__VLS_92.slots.default;
const __VLS_93 = {}.VSpacer;
/** @type {[typeof __VLS_components.VSpacer, typeof __VLS_components.vSpacer, typeof __VLS_components.VSpacer, typeof __VLS_components.vSpacer, ]} */ ;
// @ts-ignore
const __VLS_94 = __VLS_asFunctionalComponent(__VLS_93, new __VLS_93({}));
const __VLS_95 = __VLS_94({}, ...__VLS_functionalComponentArgsRest(__VLS_94));
const __VLS_97 = {}.VBtn;
/** @type {[typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, ]} */ ;
// @ts-ignore
const __VLS_98 = __VLS_asFunctionalComponent(__VLS_97, new __VLS_97({
    ...{ 'onClick': {} },
}));
const __VLS_99 = __VLS_98({
    ...{ 'onClick': {} },
}, ...__VLS_functionalComponentArgsRest(__VLS_98));
let __VLS_101;
let __VLS_102;
let __VLS_103;
const __VLS_104 = {
    onClick: (...[$event]) => {
        __VLS_ctx.createDialog = false;
    }
};
__VLS_100.slots.default;
var __VLS_100;
const __VLS_105 = {}.VBtn;
/** @type {[typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, ]} */ ;
// @ts-ignore
const __VLS_106 = __VLS_asFunctionalComponent(__VLS_105, new __VLS_105({
    ...{ 'onClick': {} },
    color: "primary",
    loading: (__VLS_ctx.saving),
}));
const __VLS_107 = __VLS_106({
    ...{ 'onClick': {} },
    color: "primary",
    loading: (__VLS_ctx.saving),
}, ...__VLS_functionalComponentArgsRest(__VLS_106));
let __VLS_109;
let __VLS_110;
let __VLS_111;
const __VLS_112 = {
    onClick: (__VLS_ctx.createUser)
};
__VLS_108.slots.default;
var __VLS_108;
var __VLS_92;
var __VLS_60;
var __VLS_56;
const __VLS_113 = {}.VDialog;
/** @type {[typeof __VLS_components.VDialog, typeof __VLS_components.vDialog, typeof __VLS_components.VDialog, typeof __VLS_components.vDialog, ]} */ ;
// @ts-ignore
const __VLS_114 = __VLS_asFunctionalComponent(__VLS_113, new __VLS_113({
    modelValue: (__VLS_ctx.editDialog),
    maxWidth: "500",
}));
const __VLS_115 = __VLS_114({
    modelValue: (__VLS_ctx.editDialog),
    maxWidth: "500",
}, ...__VLS_functionalComponentArgsRest(__VLS_114));
__VLS_116.slots.default;
const __VLS_117 = {}.VCard;
/** @type {[typeof __VLS_components.VCard, typeof __VLS_components.vCard, typeof __VLS_components.VCard, typeof __VLS_components.vCard, ]} */ ;
// @ts-ignore
const __VLS_118 = __VLS_asFunctionalComponent(__VLS_117, new __VLS_117({}));
const __VLS_119 = __VLS_118({}, ...__VLS_functionalComponentArgsRest(__VLS_118));
__VLS_120.slots.default;
const __VLS_121 = {}.VCardTitle;
/** @type {[typeof __VLS_components.VCardTitle, typeof __VLS_components.vCardTitle, typeof __VLS_components.VCardTitle, typeof __VLS_components.vCardTitle, ]} */ ;
// @ts-ignore
const __VLS_122 = __VLS_asFunctionalComponent(__VLS_121, new __VLS_121({}));
const __VLS_123 = __VLS_122({}, ...__VLS_functionalComponentArgsRest(__VLS_122));
__VLS_124.slots.default;
var __VLS_124;
const __VLS_125 = {}.VCardText;
/** @type {[typeof __VLS_components.VCardText, typeof __VLS_components.vCardText, typeof __VLS_components.VCardText, typeof __VLS_components.vCardText, ]} */ ;
// @ts-ignore
const __VLS_126 = __VLS_asFunctionalComponent(__VLS_125, new __VLS_125({}));
const __VLS_127 = __VLS_126({}, ...__VLS_functionalComponentArgsRest(__VLS_126));
__VLS_128.slots.default;
const __VLS_129 = {}.VForm;
/** @type {[typeof __VLS_components.VForm, typeof __VLS_components.vForm, typeof __VLS_components.VForm, typeof __VLS_components.vForm, ]} */ ;
// @ts-ignore
const __VLS_130 = __VLS_asFunctionalComponent(__VLS_129, new __VLS_129({}));
const __VLS_131 = __VLS_130({}, ...__VLS_functionalComponentArgsRest(__VLS_130));
__VLS_132.slots.default;
const __VLS_133 = {}.VTextField;
/** @type {[typeof __VLS_components.VTextField, typeof __VLS_components.vTextField, typeof __VLS_components.VTextField, typeof __VLS_components.vTextField, ]} */ ;
// @ts-ignore
const __VLS_134 = __VLS_asFunctionalComponent(__VLS_133, new __VLS_133({
    modelValue: (__VLS_ctx.formData.name),
    label: "Name",
    variant: "outlined",
    errorMessages: (__VLS_ctx.formErrors.name),
}));
const __VLS_135 = __VLS_134({
    modelValue: (__VLS_ctx.formData.name),
    label: "Name",
    variant: "outlined",
    errorMessages: (__VLS_ctx.formErrors.name),
}, ...__VLS_functionalComponentArgsRest(__VLS_134));
const __VLS_137 = {}.VTextField;
/** @type {[typeof __VLS_components.VTextField, typeof __VLS_components.vTextField, typeof __VLS_components.VTextField, typeof __VLS_components.vTextField, ]} */ ;
// @ts-ignore
const __VLS_138 = __VLS_asFunctionalComponent(__VLS_137, new __VLS_137({
    modelValue: (__VLS_ctx.formData.email),
    label: "Email",
    type: "email",
    variant: "outlined",
    errorMessages: (__VLS_ctx.formErrors.email),
}));
const __VLS_139 = __VLS_138({
    modelValue: (__VLS_ctx.formData.email),
    label: "Email",
    type: "email",
    variant: "outlined",
    errorMessages: (__VLS_ctx.formErrors.email),
}, ...__VLS_functionalComponentArgsRest(__VLS_138));
const __VLS_141 = {}.VTextField;
/** @type {[typeof __VLS_components.VTextField, typeof __VLS_components.vTextField, typeof __VLS_components.VTextField, typeof __VLS_components.vTextField, ]} */ ;
// @ts-ignore
const __VLS_142 = __VLS_asFunctionalComponent(__VLS_141, new __VLS_141({
    modelValue: (__VLS_ctx.formData.password),
    label: "New Password (leave blank to keep current)",
    type: "password",
    variant: "outlined",
    errorMessages: (__VLS_ctx.formErrors.password),
}));
const __VLS_143 = __VLS_142({
    modelValue: (__VLS_ctx.formData.password),
    label: "New Password (leave blank to keep current)",
    type: "password",
    variant: "outlined",
    errorMessages: (__VLS_ctx.formErrors.password),
}, ...__VLS_functionalComponentArgsRest(__VLS_142));
const __VLS_145 = {}.VSelect;
/** @type {[typeof __VLS_components.VSelect, typeof __VLS_components.vSelect, typeof __VLS_components.VSelect, typeof __VLS_components.vSelect, ]} */ ;
// @ts-ignore
const __VLS_146 = __VLS_asFunctionalComponent(__VLS_145, new __VLS_145({
    modelValue: (__VLS_ctx.formData.role),
    label: "Role",
    items: (__VLS_ctx.roleOptions),
    variant: "outlined",
}));
const __VLS_147 = __VLS_146({
    modelValue: (__VLS_ctx.formData.role),
    label: "Role",
    items: (__VLS_ctx.roleOptions),
    variant: "outlined",
}, ...__VLS_functionalComponentArgsRest(__VLS_146));
var __VLS_132;
var __VLS_128;
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
        __VLS_ctx.editDialog = false;
    }
};
__VLS_160.slots.default;
var __VLS_160;
const __VLS_165 = {}.VBtn;
/** @type {[typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, ]} */ ;
// @ts-ignore
const __VLS_166 = __VLS_asFunctionalComponent(__VLS_165, new __VLS_165({
    ...{ 'onClick': {} },
    color: "primary",
    loading: (__VLS_ctx.saving),
}));
const __VLS_167 = __VLS_166({
    ...{ 'onClick': {} },
    color: "primary",
    loading: (__VLS_ctx.saving),
}, ...__VLS_functionalComponentArgsRest(__VLS_166));
let __VLS_169;
let __VLS_170;
let __VLS_171;
const __VLS_172 = {
    onClick: (__VLS_ctx.updateUser)
};
__VLS_168.slots.default;
var __VLS_168;
var __VLS_152;
var __VLS_120;
var __VLS_116;
const __VLS_173 = {}.VDialog;
/** @type {[typeof __VLS_components.VDialog, typeof __VLS_components.vDialog, typeof __VLS_components.VDialog, typeof __VLS_components.vDialog, ]} */ ;
// @ts-ignore
const __VLS_174 = __VLS_asFunctionalComponent(__VLS_173, new __VLS_173({
    modelValue: (__VLS_ctx.deleteDialog),
    maxWidth: "400",
}));
const __VLS_175 = __VLS_174({
    modelValue: (__VLS_ctx.deleteDialog),
    maxWidth: "400",
}, ...__VLS_functionalComponentArgsRest(__VLS_174));
__VLS_176.slots.default;
const __VLS_177 = {}.VCard;
/** @type {[typeof __VLS_components.VCard, typeof __VLS_components.vCard, typeof __VLS_components.VCard, typeof __VLS_components.vCard, ]} */ ;
// @ts-ignore
const __VLS_178 = __VLS_asFunctionalComponent(__VLS_177, new __VLS_177({}));
const __VLS_179 = __VLS_178({}, ...__VLS_functionalComponentArgsRest(__VLS_178));
__VLS_180.slots.default;
const __VLS_181 = {}.VCardTitle;
/** @type {[typeof __VLS_components.VCardTitle, typeof __VLS_components.vCardTitle, typeof __VLS_components.VCardTitle, typeof __VLS_components.vCardTitle, ]} */ ;
// @ts-ignore
const __VLS_182 = __VLS_asFunctionalComponent(__VLS_181, new __VLS_181({}));
const __VLS_183 = __VLS_182({}, ...__VLS_functionalComponentArgsRest(__VLS_182));
__VLS_184.slots.default;
var __VLS_184;
const __VLS_185 = {}.VCardText;
/** @type {[typeof __VLS_components.VCardText, typeof __VLS_components.vCardText, typeof __VLS_components.VCardText, typeof __VLS_components.vCardText, ]} */ ;
// @ts-ignore
const __VLS_186 = __VLS_asFunctionalComponent(__VLS_185, new __VLS_185({}));
const __VLS_187 = __VLS_186({}, ...__VLS_functionalComponentArgsRest(__VLS_186));
__VLS_188.slots.default;
__VLS_asFunctionalElement(__VLS_intrinsicElements.strong, __VLS_intrinsicElements.strong)({});
(__VLS_ctx.selectedUser?.name);
var __VLS_188;
const __VLS_189 = {}.VCardActions;
/** @type {[typeof __VLS_components.VCardActions, typeof __VLS_components.vCardActions, typeof __VLS_components.VCardActions, typeof __VLS_components.vCardActions, ]} */ ;
// @ts-ignore
const __VLS_190 = __VLS_asFunctionalComponent(__VLS_189, new __VLS_189({}));
const __VLS_191 = __VLS_190({}, ...__VLS_functionalComponentArgsRest(__VLS_190));
__VLS_192.slots.default;
const __VLS_193 = {}.VSpacer;
/** @type {[typeof __VLS_components.VSpacer, typeof __VLS_components.vSpacer, typeof __VLS_components.VSpacer, typeof __VLS_components.vSpacer, ]} */ ;
// @ts-ignore
const __VLS_194 = __VLS_asFunctionalComponent(__VLS_193, new __VLS_193({}));
const __VLS_195 = __VLS_194({}, ...__VLS_functionalComponentArgsRest(__VLS_194));
const __VLS_197 = {}.VBtn;
/** @type {[typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, ]} */ ;
// @ts-ignore
const __VLS_198 = __VLS_asFunctionalComponent(__VLS_197, new __VLS_197({
    ...{ 'onClick': {} },
}));
const __VLS_199 = __VLS_198({
    ...{ 'onClick': {} },
}, ...__VLS_functionalComponentArgsRest(__VLS_198));
let __VLS_201;
let __VLS_202;
let __VLS_203;
const __VLS_204 = {
    onClick: (...[$event]) => {
        __VLS_ctx.deleteDialog = false;
    }
};
__VLS_200.slots.default;
var __VLS_200;
const __VLS_205 = {}.VBtn;
/** @type {[typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, typeof __VLS_components.VBtn, typeof __VLS_components.vBtn, ]} */ ;
// @ts-ignore
const __VLS_206 = __VLS_asFunctionalComponent(__VLS_205, new __VLS_205({
    ...{ 'onClick': {} },
    color: "error",
    loading: (__VLS_ctx.deleting),
}));
const __VLS_207 = __VLS_206({
    ...{ 'onClick': {} },
    color: "error",
    loading: (__VLS_ctx.deleting),
}, ...__VLS_functionalComponentArgsRest(__VLS_206));
let __VLS_209;
let __VLS_210;
let __VLS_211;
const __VLS_212 = {
    onClick: (__VLS_ctx.deleteUser)
};
__VLS_208.slots.default;
var __VLS_208;
var __VLS_192;
var __VLS_180;
var __VLS_176;
const __VLS_213 = {}.VSnackbar;
/** @type {[typeof __VLS_components.VSnackbar, typeof __VLS_components.vSnackbar, typeof __VLS_components.VSnackbar, typeof __VLS_components.vSnackbar, ]} */ ;
// @ts-ignore
const __VLS_214 = __VLS_asFunctionalComponent(__VLS_213, new __VLS_213({
    modelValue: (__VLS_ctx.snackbar),
    color: (__VLS_ctx.snackbarColor),
}));
const __VLS_215 = __VLS_214({
    modelValue: (__VLS_ctx.snackbar),
    color: (__VLS_ctx.snackbarColor),
}, ...__VLS_functionalComponentArgsRest(__VLS_214));
__VLS_216.slots.default;
(__VLS_ctx.snackbarText);
var __VLS_216;
var __VLS_3;
/** @type {__VLS_StyleScopedClasses['page-container']} */ ;
/** @type {__VLS_StyleScopedClasses['text-h4']} */ ;
/** @type {__VLS_StyleScopedClasses['page-title']} */ ;
/** @type {__VLS_StyleScopedClasses['d-flex']} */ ;
/** @type {__VLS_StyleScopedClasses['align-center']} */ ;
/** @type {__VLS_StyleScopedClasses['flex-grow-1']} */ ;
/** @type {__VLS_StyleScopedClasses['d-flex']} */ ;
/** @type {__VLS_StyleScopedClasses['align-center']} */ ;
/** @type {__VLS_StyleScopedClasses['mr-2']} */ ;
/** @type {__VLS_StyleScopedClasses['text-caption']} */ ;
var __VLS_dollars;
const __VLS_self = (await Promise.resolve().then(() => __importStar(require('vue')))).defineComponent({
    setup() {
        return {
            loading: loading,
            saving: saving,
            deleting: deleting,
            users: users,
            createDialog: createDialog,
            editDialog: editDialog,
            deleteDialog: deleteDialog,
            selectedUser: selectedUser,
            snackbar: snackbar,
            snackbarText: snackbarText,
            snackbarColor: snackbarColor,
            formData: formData,
            formErrors: formErrors,
            roleOptions: roleOptions,
            headers: headers,
            showCreateDialog: showCreateDialog,
            showEditDialog: showEditDialog,
            showDeleteDialog: showDeleteDialog,
            createUser: createUser,
            updateUser: updateUser,
            deleteUser: deleteUser,
            getRoleColor: getRoleColor,
        };
    },
});
exports.default = (await Promise.resolve().then(() => __importStar(require('vue')))).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
//# sourceMappingURL=UsersPage.vue.js.map