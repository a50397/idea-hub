<template>
  <v-container fluid class="page-container">
    <h1 class="text-h4 page-title">{{ t('users.title') }}</h1>

    <v-card>
      <v-card-title class="d-flex align-center">
        <span class="flex-grow-1">{{ t('users.users') }}</span>
        <v-btn @click="showCreateDialog" color="primary" prepend-icon="mdi-plus">
          {{ t('users.createUser') }}
        </v-btn>
      </v-card-title>
      <v-card-text>
        <v-data-table
          :headers="headers"
          :items="users"
          :loading="loading"
          item-value="id"
        >
          <template v-slot:item.name="{ item }">
            <div class="d-flex align-center">
              <v-avatar
                :image="`https://ui-avatars.com/api/?name=${item.name}&background=1976D2&color=fff`"
                size="32"
                class="mr-2"
              ></v-avatar>
              {{ item.name }}
            </div>
          </template>
          <template v-slot:item.role="{ item }">
            <v-chip :color="getRoleColor(item.role)" size="small">
              {{ t(`roles.${item.role}`) }}
            </v-chip>
          </template>
          <template v-slot:item.stats="{ item }">
            <div class="text-caption">
              <div>{{ item._count?.submittedIdeas || 0 }} {{ t('users.submitted') }}</div>
              <div>{{ item._count?.assignedIdeas || 0 }} {{ t('users.assigned') }}</div>
            </div>
          </template>
          <template v-slot:item.actions="{ item }">
            <v-btn
              icon="mdi-pencil"
              size="small"
              variant="text"
              @click="showEditDialog(item)"
            ></v-btn>
            <v-btn
              icon="mdi-delete"
              size="small"
              variant="text"
              color="error"
              @click="showDeleteDialog(item)"
            ></v-btn>
          </template>
        </v-data-table>
      </v-card-text>
    </v-card>

    <v-dialog v-model="createDialog" max-width="500">
      <v-card>
        <v-card-title>{{ t('users.createUser') }}</v-card-title>
        <v-card-text>
          <v-form>
            <v-text-field
              v-model="formData.name"
              :label="t('users.name') + ' *'"
              variant="outlined"
              :error-messages="formErrors.name"
            ></v-text-field>
            <v-text-field
              v-model="formData.email"
              :label="t('users.email') + ' *'"
              type="email"
              variant="outlined"
              :error-messages="formErrors.email"
            ></v-text-field>
            <v-text-field
              v-model="formData.password"
              :label="t('users.password') + ' *'"
              type="password"
              variant="outlined"
              :error-messages="formErrors.password"
            ></v-text-field>
            <v-select
              v-model="formData.role"
              :label="t('users.role') + ' *'"
              :items="roleOptions"
              variant="outlined"
            ></v-select>
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="createDialog = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="primary" @click="createUser" :loading="saving">
            {{ t('common.submit') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="editDialog" max-width="500">
      <v-card>
        <v-card-title>{{ t('users.editUser') }}</v-card-title>
        <v-card-text>
          <v-form>
            <v-text-field
              v-model="formData.name"
              :label="t('users.name')"
              variant="outlined"
              :error-messages="formErrors.name"
            ></v-text-field>
            <v-text-field
              v-model="formData.email"
              :label="t('users.email')"
              type="email"
              variant="outlined"
              :error-messages="formErrors.email"
            ></v-text-field>
            <v-text-field
              v-model="formData.password"
              :label="t('users.password')"
              type="password"
              variant="outlined"
              :error-messages="formErrors.password"
            ></v-text-field>
            <v-select
              v-model="formData.role"
              :label="t('users.role')"
              :items="roleOptions"
              variant="outlined"
            ></v-select>
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="editDialog = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="primary" @click="updateUser" :loading="saving">
            {{ t('common.save') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="deleteDialog" max-width="400">
      <v-card>
        <v-card-title>{{ t('common.delete') }}</v-card-title>
        <v-card-text>
          {{ t('users.deleteConfirm') }}
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="deleteDialog = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="error" @click="deleteUser" :loading="deleting">
            {{ t('common.delete') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar" :color="snackbarColor">
      {{ snackbarText }}
    </v-snackbar>
  </v-container>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { usersApi } from '../api/users';
import { Role } from '../types';
import type { UserWithCounts } from '../types';

const { t } = useI18n();

const loading = ref(false);
const saving = ref(false);
const deleting = ref(false);
const users = ref<UserWithCounts[]>([]);
const createDialog = ref(false);
const editDialog = ref(false);
const deleteDialog = ref(false);
const selectedUser = ref<UserWithCounts | null>(null);
const snackbar = ref(false);
const snackbarText = ref('');
const snackbarColor = ref('success');

const formData = reactive({
  name: '',
  email: '',
  password: '',
  role: Role.USER,
});

const formErrors = reactive({
  name: [] as string[],
  email: [] as string[],
  password: [] as string[],
});

const roleOptions = computed(() => [
  { title: t('roles.USER'), value: Role.USER },
  { title: t('roles.POWER_USER'), value: Role.POWER_USER },
  { title: t('roles.ADMIN'), value: Role.ADMIN },
]);

const headers = computed(() => [
  { title: t('users.name'), key: 'name', sortable: true },
  { title: t('users.email'), key: 'email', sortable: true },
  { title: t('users.role'), key: 'role', sortable: true },
  { title: t('users.stats'), key: 'stats', sortable: false },
  { title: t('users.actions'), key: 'actions', sortable: false },
]);

async function loadUsers() {
  loading.value = true;
  try {
    users.value = await usersApi.getAll();
  } catch (error) {
    console.error('Error loading users:', error);
    snackbarText.value = t('users.loadError');
    snackbarColor.value = 'error';
    snackbar.value = true;
  } finally {
    loading.value = false;
  }
}

function showCreateDialog() {
  resetForm();
  createDialog.value = true;
}

function showEditDialog(user: UserWithCounts) {
  selectedUser.value = user;
  formData.name = user.name;
  formData.email = user.email;
  formData.password = '';
  formData.role = user.role;
  resetErrors();
  editDialog.value = true;
}

function showDeleteDialog(user: UserWithCounts) {
  selectedUser.value = user;
  deleteDialog.value = true;
}

function validateForm(isCreate: boolean): boolean {
  resetErrors();
  let valid = true;

  if (!formData.name) {
    formErrors.name.push(t('auth.emailRequired')); // Note: reusing existing translation
    valid = false;
  }

  if (!formData.email) {
    formErrors.email.push(t('auth.emailRequired'));
    valid = false;
  }

  if (isCreate && !formData.password) {
    formErrors.password.push(t('auth.passwordRequired'));
    valid = false;
  }

  if (formData.password && formData.password.length < 6) {
    formErrors.password.push('Password must be at least 6 characters');
    valid = false;
  }

  return valid;
}

async function createUser() {
  if (!validateForm(true)) return;

  saving.value = true;
  try {
    await usersApi.create({
      name: formData.name,
      email: formData.email,
      password: formData.password,
      role: formData.role,
    });
    snackbarText.value = t('users.createSuccess');
    snackbarColor.value = 'success';
    snackbar.value = true;
    createDialog.value = false;
    await loadUsers();
  } catch (error: any) {
    snackbarText.value = error.response?.data?.error || t('users.createError');
    snackbarColor.value = 'error';
    snackbar.value = true;
  } finally {
    saving.value = false;
  }
}

async function updateUser() {
  if (!selectedUser.value) return;
  if (!validateForm(false)) return;

  saving.value = true;
  try {
    const updateData: any = {
      name: formData.name,
      email: formData.email,
      role: formData.role,
    };
    if (formData.password) {
      updateData.password = formData.password;
    }

    await usersApi.update(selectedUser.value.id, updateData);
    snackbarText.value = t('users.updateSuccess');
    snackbarColor.value = 'success';
    snackbar.value = true;
    editDialog.value = false;
    await loadUsers();
  } catch (error: any) {
    snackbarText.value = error.response?.data?.error || t('users.updateError');
    snackbarColor.value = 'error';
    snackbar.value = true;
  } finally {
    saving.value = false;
  }
}

async function deleteUser() {
  if (!selectedUser.value) return;

  deleting.value = true;
  try {
    await usersApi.delete(selectedUser.value.id);
    snackbarText.value = t('users.deleteSuccess');
    snackbarColor.value = 'success';
    snackbar.value = true;
    deleteDialog.value = false;
    await loadUsers();
  } catch (error: any) {
    snackbarText.value = error.response?.data?.error || t('users.deleteError');
    snackbarColor.value = 'error';
    snackbar.value = true;
  } finally {
    deleting.value = false;
  }
}

function resetForm() {
  formData.name = '';
  formData.email = '';
  formData.password = '';
  formData.role = Role.USER;
  resetErrors();
}

function resetErrors() {
  formErrors.name = [];
  formErrors.email = [];
  formErrors.password = [];
}

function getRoleColor(role: Role): string {
  switch (role) {
    case Role.ADMIN:
      return 'error';
    case Role.POWER_USER:
      return 'warning';
    default:
      return 'info';
  }
}

onMounted(() => {
  loadUsers();
});
</script>
