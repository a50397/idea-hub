<template>
  <v-container fluid class="page-container">
    <h1 class="text-h4 page-title">User Management</h1>

    <v-card>
      <v-card-title class="d-flex align-center">
        <span class="flex-grow-1">Users</span>
        <v-btn @click="showCreateDialog" color="primary" prepend-icon="mdi-plus">
          Create User
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
              {{ item.role }}
            </v-chip>
          </template>
          <template v-slot:item.stats="{ item }">
            <div class="text-caption">
              <div>{{ item._count?.submittedIdeas || 0 }} submitted</div>
              <div>{{ item._count?.assignedIdeas || 0 }} assigned</div>
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
        <v-card-title>Create User</v-card-title>
        <v-card-text>
          <v-form>
            <v-text-field
              v-model="formData.name"
              label="Name *"
              variant="outlined"
              :error-messages="formErrors.name"
            ></v-text-field>
            <v-text-field
              v-model="formData.email"
              label="Email *"
              type="email"
              variant="outlined"
              :error-messages="formErrors.email"
            ></v-text-field>
            <v-text-field
              v-model="formData.password"
              label="Password *"
              type="password"
              variant="outlined"
              :error-messages="formErrors.password"
            ></v-text-field>
            <v-select
              v-model="formData.role"
              label="Role *"
              :items="roleOptions"
              variant="outlined"
            ></v-select>
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="createDialog = false">Cancel</v-btn>
          <v-btn color="primary" @click="createUser" :loading="saving">
            Create
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="editDialog" max-width="500">
      <v-card>
        <v-card-title>Edit User</v-card-title>
        <v-card-text>
          <v-form>
            <v-text-field
              v-model="formData.name"
              label="Name"
              variant="outlined"
              :error-messages="formErrors.name"
            ></v-text-field>
            <v-text-field
              v-model="formData.email"
              label="Email"
              type="email"
              variant="outlined"
              :error-messages="formErrors.email"
            ></v-text-field>
            <v-text-field
              v-model="formData.password"
              label="New Password (leave blank to keep current)"
              type="password"
              variant="outlined"
              :error-messages="formErrors.password"
            ></v-text-field>
            <v-select
              v-model="formData.role"
              label="Role"
              :items="roleOptions"
              variant="outlined"
            ></v-select>
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="editDialog = false">Cancel</v-btn>
          <v-btn color="primary" @click="updateUser" :loading="saving">
            Update
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="deleteDialog" max-width="400">
      <v-card>
        <v-card-title>Delete User</v-card-title>
        <v-card-text>
          Are you sure you want to delete <strong>{{ selectedUser?.name }}</strong>?
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="deleteDialog = false">Cancel</v-btn>
          <v-btn color="error" @click="deleteUser" :loading="deleting">
            Delete
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
import { ref, reactive, onMounted } from 'vue';
import { usersApi } from '../api/users';
import { Role } from '../types';
import type { UserWithCounts } from '../types';

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

const roleOptions = [
  { title: 'User', value: Role.USER },
  { title: 'Power User', value: Role.POWER_USER },
  { title: 'Admin', value: Role.ADMIN },
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
    users.value = await usersApi.getAll();
  } catch (error) {
    console.error('Error loading users:', error);
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
  if (!validateForm(true)) return;

  saving.value = true;
  try {
    await usersApi.create({
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
  } catch (error: any) {
    snackbarText.value = error.response?.data?.error || 'Failed to create user';
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
    snackbarText.value = 'User updated successfully!';
    snackbarColor.value = 'success';
    snackbar.value = true;
    editDialog.value = false;
    await loadUsers();
  } catch (error: any) {
    snackbarText.value = error.response?.data?.error || 'Failed to update user';
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
    snackbarText.value = 'User deleted successfully';
    snackbarColor.value = 'success';
    snackbar.value = true;
    deleteDialog.value = false;
    await loadUsers();
  } catch (error: any) {
    snackbarText.value = error.response?.data?.error || 'Failed to delete user';
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
