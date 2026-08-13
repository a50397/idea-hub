<template>
  <v-container fluid class="page-container">
    <h1 class="text-h4 page-title">{{ $t('departments.title') }}</h1>

    <v-card>
      <v-card-title class="d-flex align-center">
        <span class="flex-grow-1">{{ $t('departments.departmentsLabel') }}</span>
        <v-btn @click="showCreateDialog" color="primary" prepend-icon="mdi-plus">
          {{ $t('departments.createDepartment') }}
        </v-btn>
      </v-card-title>
      <v-card-text>
        <v-data-table
          :headers="headers"
          :items="departmentsStore.sortedByOrder"
          :loading="departmentsStore.loading"
          item-value="id"
        >
          <template v-slot:item.ideasCount="{ item }">
            {{ item._count?.ideas ?? 0 }}
          </template>
          <template v-slot:item.notifications="{ item }">
            <v-chip
              v-if="(item.notificationEmails?.length ?? 0) > 0"
              size="small"
              color="info"
              variant="tonal"
            >
              {{ item.notificationEmails?.length ?? 0 }}
            </v-chip>
            <span v-else class="text-disabled">0</span>
          </template>
          <template v-slot:item.actions="{ item }">
            <v-btn
              icon="mdi-arrow-up"
              size="small"
              variant="text"
              :aria-label="$t('departments.moveUp')"
              :disabled="isFirst(item) || departmentsStore.loading"
              @click="moveUp(item)"
            ></v-btn>
            <v-btn
              icon="mdi-arrow-down"
              size="small"
              variant="text"
              :aria-label="$t('departments.moveDown')"
              :disabled="isLast(item) || departmentsStore.loading"
              @click="moveDown(item)"
            ></v-btn>
            <v-btn
              icon="mdi-pencil"
              size="small"
              variant="text"
              :aria-label="$t('departments.editDepartment')"
              @click="showEditDialog(item)"
            ></v-btn>
            <v-btn
              icon="mdi-delete"
              size="small"
              variant="text"
              :aria-label="$t('departments.deleteDepartment')"
              color="error"
              @click="showDeleteDialog(item)"
            ></v-btn>
          </template>
        </v-data-table>
      </v-card-text>
    </v-card>

    <v-dialog v-model="createDialog" max-width="500">
      <v-card>
        <v-card-title>{{ $t('departments.createDepartment') }}</v-card-title>
        <v-card-text>
          <v-form @submit.prevent="createDepartment">
            <v-text-field
              v-model="formName"
              :label="$t('departments.name') + ' *'"
              variant="outlined"
              :error-messages="formErrors.name"
            ></v-text-field>
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="createDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="primary" @click="createDepartment" :loading="saving">
            {{ $t('common.create') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="editDialog" max-width="500">
      <v-card>
        <v-card-title>{{ $t('departments.editDepartment') }}</v-card-title>
        <v-card-text>
          <v-form @submit.prevent="updateDepartment">
            <v-text-field
              v-model="formName"
              :label="$t('departments.name') + ' *'"
              variant="outlined"
              :error-messages="formErrors.name"
            ></v-text-field>
            <v-combobox
              :model-value="formEmails"
              @update:model-value="normalizeEmails"
              @keydown.enter.prevent
              :label="$t('departments.notificationEmails')"
              variant="outlined"
              multiple
              chips
              closable-chips
              :hint="$t('departments.notificationEmailsHint')"
              persistent-hint
              :error-messages="formErrors.emails"
              class="mb-4"
            ></v-combobox>
            <!-- Webex spaces: pick from the bot's rooms (item title shown, room id is
                 the stored value) or type a raw room id (free text). return-object=false
                 keeps the model an array of id STRINGS. Always shown; when the bot's
                 rooms can't be loaded the hint switches to explain manual entry. -->
            <v-combobox
              :model-value="formRoomIds"
              @update:model-value="normalizeRoomIds"
              @keydown.enter.prevent
              :label="$t('departments.webexRoomIds')"
              variant="outlined"
              multiple
              chips
              closable-chips
              :loading="webexRoomsLoading"
              :items="webexRoomItems"
              item-title="title"
              item-value="value"
              :return-object="false"
              :hint="webexRoomsHint"
              persistent-hint
              :error-messages="formErrors.roomIds"
              class="mb-4"
            ></v-combobox>
            <!-- Jira project-key override: pick from the tech user's visible projects
                 (item title shown, project key is the stored value) or type a raw key
                 manually. Single-value (not `multiple`): the model is one string, or
                 '' when cleared (falls back to the installation-wide default). -->
            <v-combobox
              :model-value="formJiraProjectKey"
              @update:model-value="normalizeJiraProjectKey"
              @keydown.enter.prevent
              :label="$t('departments.jiraProjectKey')"
              variant="outlined"
              clearable
              :loading="jiraProjectsLoading"
              :items="jiraProjectItems"
              item-title="title"
              item-value="value"
              :return-object="false"
              :hint="jiraProjectsHint"
              persistent-hint
              :error-messages="formErrors.jiraProjectKey"
            ></v-combobox>
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="editDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="primary" @click="updateDepartment" :loading="saving">
            {{ $t('common.update') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="deleteDialog" max-width="400">
      <v-card>
        <v-card-title>{{ $t('departments.deleteDepartment') }}</v-card-title>
        <v-card-text>
          {{ $t('departments.deleteConfirm') }} <strong>{{ selectedDepartment?.name }}</strong>?
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="deleteDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="error" @click="deleteDepartment" :loading="deleting">
            {{ $t('common.delete') }}
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
import { ref, reactive, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useDepartmentsStore } from '../stores/departments';
import { webexSettingsApi, type WebexRoom } from '../api/webexSettings';
import { jiraSettingsApi } from '../api/jiraSettings';
import type { Department, JiraProject } from '../types';

const { t } = useI18n();
const departmentsStore = useDepartmentsStore();

const saving = ref(false);
const deleting = ref(false);
const createDialog = ref(false);
const editDialog = ref(false);
const deleteDialog = ref(false);
const selectedDepartment = ref<Department | null>(null);
const formName = ref('');
const formEmails = ref<string[]>([]);
const formRoomIds = ref<string[]>([]);
const formJiraProjectKey = ref('');
const snackbar = ref(false);
const snackbarText = ref('');
const snackbarColor = ref('success');

// The bot's Webex rooms, loaded on mount and refreshed whenever an edit dialog opens
// (so a space the bot was just added to appears without a full reload), shared by every
// department's editor. `webexRoomsUnavailable` is set ONLY when the load reported a
// failure reason (Webex off/unreachable/token rejected) — a genuinely empty list is a
// success — and flips the combobox hint to explain ids can still be entered by hand.
// `webexRoomsLoading` is true while the /rooms round-trip is in flight so an empty list
// mid-load isn't mistaken for "no spaces".
const webexRooms = ref<WebexRoom[]>([]);
const webexRoomsUnavailable = ref(false);
const webexRoomsLoading = ref(false);

// The tech user's visible Jira projects, loaded and refreshed exactly like the
// Webex rooms above, powering the per-department project-key override picker.
const jiraProjects = ref<JiraProject[]>([]);
const jiraProjectsUnavailable = ref(false);
const jiraProjectsLoading = ref(false);

const formErrors = reactive({
  name: [] as string[],
  emails: [] as string[],
  roomIds: [] as string[],
  jiraProjectKey: [] as string[],
});

// Pragmatic email shape check for per-entry validation in the edit dialog. The
// backend (zod .email()) is the authority; this only gives fast inline feedback.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Mirrors the backend cap (updateDepartmentSchema: .max(20)) so the admin gets an
// inline message instead of a silent 400. The backend caps the RAW array length
// (before its case-insensitive de-dup), so we count entries the same way.
const MAX_NOTIFICATION_EMAILS = 20;

// Mirror the backend webexRoomIds caps (updateDepartmentSchema: .array(.max(256)).max(50))
// so an over-long or over-full list fails inline instead of as a silent 400. Room ids
// are opaque, so there is no format to validate — only these length/count bounds.
const MAX_WEBEX_ROOM_IDS = 50;
const MAX_WEBEX_ROOM_ID_LENGTH = 256;

// Mirrors the backend jiraProjectKeySchema (utils/validation.ts): must start with a
// letter and contain only letters/digits/underscores, capped at 32 chars. An empty
// value is always allowed — it clears the override (falls back to the
// installation-wide default).
const JIRA_PROJECT_KEY_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const MAX_JIRA_PROJECT_KEY_LENGTH = 32;

const headers = computed(() => [
  { title: t('departments.order'), key: 'order', sortable: true },
  { title: t('departments.name'), key: 'name', sortable: true },
  { title: t('departments.ideasCount'), key: 'ideasCount', sortable: false },
  { title: t('departments.notifications'), key: 'notifications', sortable: false },
  { title: t('common.actions'), key: 'actions', sortable: false },
]);

// The bot's rooms as combobox items: `title` is shown in the dropdown and chip, the
// room `id` is the value stored in the model. Ids typed manually that match no room
// stay as their own raw-id chip.
const webexRoomItems = computed(() =>
  webexRooms.value.map((room) => ({ title: room.title, value: room.id }))
);

// Four-state hint, in precedence order: while the rooms are loading say so; if the load
// failed (a reason came back) reassure that ids can still be entered manually; if the bot
// is in no space yet explain how to add it; otherwise the normal invite to pick or type.
const webexRoomsHint = computed(() => {
  if (webexRoomsLoading.value) return t('departments.webexRoomsLoading');
  if (webexRoomsUnavailable.value) return t('departments.webexRoomIdsUnavailable');
  if (webexRooms.value.length === 0) return t('departments.webexRoomsEmpty');
  return t('departments.webexRoomIdsHint');
});

// The tech user's Jira projects as combobox items: `title` is shown in the dropdown
// and chip, the project `key` is the value stored in the model.
const jiraProjectItems = computed(() =>
  jiraProjects.value.map((p) => ({ title: `${p.key} — ${p.name}`, value: p.key }))
);

// Same four-state hint pattern as the Webex spaces picker above.
const jiraProjectsHint = computed(() => {
  if (jiraProjectsLoading.value) return t('departments.jiraProjectsLoading');
  if (jiraProjectsUnavailable.value) return t('departments.jiraProjectKeyUnavailable');
  if (jiraProjects.value.length === 0) return t('departments.jiraProjectsEmpty');
  return t('departments.jiraProjectKeyHint');
});

function isFirst(dept: Department): boolean {
  return departmentsStore.sortedByOrder[0]?.id === dept.id;
}

function isLast(dept: Department): boolean {
  const sorted = departmentsStore.sortedByOrder;
  return sorted[sorted.length - 1]?.id === dept.id;
}

function notify(text: string, color: string) {
  snackbarText.value = text;
  snackbarColor.value = color;
  snackbar.value = true;
}

function validateName(): boolean {
  formErrors.name = [];
  if (!formName.value.trim()) {
    formErrors.name.push(t('departments.nameRequired'));
    return false;
  }
  return true;
}

// Every notification-email chip must look like an email; a single invalid entry
// blocks the save and surfaces a message on the combobox. The count is capped
// first (matching the backend) so >20 entries fail with a specific message.
function validateEmails(): boolean {
  formErrors.emails = [];
  if (formEmails.value.length > MAX_NOTIFICATION_EMAILS) {
    formErrors.emails.push(t('departments.tooManyEmails'));
    return false;
  }
  const hasInvalid = formEmails.value.some((e) => !EMAIL_RE.test(e.trim()));
  if (hasInvalid) {
    formErrors.emails.push(t('departments.invalidEmails'));
    return false;
  }
  return true;
}

// Room ids are opaque (no format to check), so only the backend's count/length caps
// are enforced inline: the count is checked first (matching the backend), then any
// single over-long id, so >50 ids or an over-256-char id fails with a specific message.
function validateRoomIds(): boolean {
  formErrors.roomIds = [];
  if (formRoomIds.value.length > MAX_WEBEX_ROOM_IDS) {
    formErrors.roomIds.push(t('departments.tooManyWebexRoomIds'));
    return false;
  }
  if (formRoomIds.value.some((id) => id.trim().length > MAX_WEBEX_ROOM_ID_LENGTH)) {
    formErrors.roomIds.push(t('departments.webexRoomIdTooLong'));
    return false;
  }
  return true;
}

// An empty key is always valid (it clears the override); otherwise it must match
// the backend's key shape and length cap.
function validateJiraProjectKey(): boolean {
  formErrors.jiraProjectKey = [];
  const value = formJiraProjectKey.value.trim();
  if (value.length === 0) return true;
  if (value.length > MAX_JIRA_PROJECT_KEY_LENGTH) {
    formErrors.jiraProjectKey.push(t('departments.jiraProjectKeyTooLong'));
    return false;
  }
  if (!JIRA_PROJECT_KEY_RE.test(value)) {
    formErrors.jiraProjectKey.push(t('departments.jiraProjectKeyInvalid'));
    return false;
  }
  return true;
}

// A single combobox entry can arrive as a comma/semicolon/whitespace-separated
// paste (e.g. "a@x.com, b@y.com"); split every entry on those separators, trim,
// and drop empty fragments so each address becomes its own individually-validated
// chip. Normal single-entry-then-Enter has no separators, so it passes through
// unchanged.
function normalizeEmails(value: string[]) {
  formEmails.value = value
    .flatMap((entry) => entry.split(/[,;\s]+/))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

// The Webex combobox is bound to an array of room-id STRINGS. Selecting a bot room
// contributes that room's id (the item value); typing a raw id contributes the text
// verbatim — return-object=false yields strings for both. Coerce each entry to its id
// string (defensive), split any pasted separator-joined list, trim, drop blanks, and
// finally drop duplicate ids (first-seen order kept) so the same id can't render as two
// chips — mirroring normalizeEmails.
function normalizeRoomIds(value: Array<string | { value?: string }>) {
  const seen = new Set<string>();
  formRoomIds.value = value
    .map((entry) => (typeof entry === 'string' ? entry : entry?.value ?? ''))
    .flatMap((entry) => entry.split(/[,;\s]+/))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

// The Jira combobox is bound to a SINGLE key string (not `multiple`): picking a
// project contributes its key (the item value), typing contributes the raw text,
// and clearing emits null — coerce every shape to a trimmed, UPPERCASED string (the
// backend uppercases too; doing it here keeps the field's own display consistent
// with what will be stored, mirroring the common project-key convention).
function normalizeJiraProjectKey(value: string | { value?: string } | null) {
  const raw = typeof value === 'string' ? value : value?.value ?? '';
  formJiraProjectKey.value = raw.trim().toUpperCase();
}

// Load the bot's Webex rooms and cache them; every department's editor shares this one
// item list. Best-effort: getRooms always resolves 200 with { rooms } on success (a
// genuinely empty list included) or { rooms: [], reason } on failure (Webex off /
// unreachable / token rejected); only a reason — or a rejected request — flags the
// control unavailable so its hint explains ids can still be entered manually. The
// in-flight flag lets the hint say "loading" instead of mistaking a pending fetch for an
// empty bot. Never surfaces a token or raw error.
async function loadWebexRooms() {
  webexRoomsLoading.value = true;
  try {
    const { rooms, reason } = await webexSettingsApi.getRooms();
    webexRooms.value = rooms;
    webexRoomsUnavailable.value = reason !== undefined;
  } catch {
    webexRooms.value = [];
    webexRoomsUnavailable.value = true;
  } finally {
    webexRoomsLoading.value = false;
  }
}

// Load the tech user's Jira projects and cache them; every department's editor
// shares this one item list. Same always-200-with-reason contract as loadWebexRooms.
async function loadJiraProjects() {
  jiraProjectsLoading.value = true;
  try {
    const { projects, reason } = await jiraSettingsApi.getProjects();
    jiraProjects.value = projects;
    jiraProjectsUnavailable.value = reason !== undefined;
  } catch {
    jiraProjects.value = [];
    jiraProjectsUnavailable.value = true;
  } finally {
    jiraProjectsLoading.value = false;
  }
}

function showCreateDialog() {
  formName.value = '';
  formEmails.value = [];
  formRoomIds.value = [];
  formJiraProjectKey.value = '';
  formErrors.name = [];
  formErrors.emails = [];
  formErrors.roomIds = [];
  formErrors.jiraProjectKey = [];
  createDialog.value = true;
}

function showEditDialog(dept: Department) {
  selectedDepartment.value = dept;
  formName.value = dept.name;
  formEmails.value = [...(dept.notificationEmails ?? [])];
  formRoomIds.value = [...(dept.webexRoomIds ?? [])];
  formJiraProjectKey.value = dept.jiraProjectKey ?? '';
  formErrors.name = [];
  formErrors.emails = [];
  formErrors.roomIds = [];
  formErrors.jiraProjectKey = [];
  editDialog.value = true;
  // Refresh the shared room/project lists best-effort so a space the bot was just
  // added to, or a project just made visible, shows up without a full page reload.
  // Both loaders are self-contained (their own try/catch/finally), so neither throws
  // nor blocks the dialog from opening.
  loadWebexRooms();
  loadJiraProjects();
}

function showDeleteDialog(dept: Department) {
  selectedDepartment.value = dept;
  deleteDialog.value = true;
}

async function createDepartment() {
  if (!validateName()) return;
  saving.value = true;
  const ok = await departmentsStore.create(formName.value.trim());
  saving.value = false;
  if (ok) {
    notify(t('departments.createSuccess'), 'success');
    createDialog.value = false;
  } else {
    notify(departmentsStore.error || t('departments.createDepartment'), 'error');
  }
}

async function updateDepartment() {
  if (!selectedDepartment.value) return;
  // Run every validator (not short-circuited) so each surfaces its own message.
  const nameOk = validateName();
  const emailsOk = validateEmails();
  const roomIdsOk = validateRoomIds();
  const jiraProjectKeyOk = validateJiraProjectKey();
  if (!nameOk || !emailsOk || !roomIdsOk || !jiraProjectKeyOk) return;
  saving.value = true;
  const ok = await departmentsStore.update(selectedDepartment.value.id, {
    name: formName.value.trim(),
    notificationEmails: formEmails.value.map((e) => e.trim()),
    webexRoomIds: formRoomIds.value.map((id) => id.trim()),
    jiraProjectKey: formJiraProjectKey.value.trim().toUpperCase(),
  });
  saving.value = false;
  if (ok) {
    notify(t('departments.updateSuccess'), 'success');
    editDialog.value = false;
  } else {
    notify(departmentsStore.error || t('departments.editDepartment'), 'error');
  }
}

async function deleteDepartment() {
  if (!selectedDepartment.value) return;
  deleting.value = true;
  const ok = await departmentsStore.remove(selectedDepartment.value.id);
  deleting.value = false;
  if (ok) {
    notify(t('departments.deleteSuccess'), 'success');
    deleteDialog.value = false;
  } else {
    // Surface backend 409s (still referenced by ideas / last remaining department).
    notify(departmentsStore.error || t('departments.deleteDepartment'), 'error');
  }
}

// Reorder sends the FULL id permutation (backend requires every id) with the two
// affected rows swapped, then relies on the store to refresh from the response.
async function moveUp(dept: Department) {
  const ids = departmentsStore.sortedByOrder.map((d) => d.id);
  const i = ids.indexOf(dept.id);
  if (i <= 0) return;
  [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
  await submitReorder(ids);
}

async function moveDown(dept: Department) {
  const ids = departmentsStore.sortedByOrder.map((d) => d.id);
  const i = ids.indexOf(dept.id);
  if (i < 0 || i >= ids.length - 1) return;
  [ids[i], ids[i + 1]] = [ids[i + 1], ids[i]];
  await submitReorder(ids);
}

async function submitReorder(ids: string[]) {
  const ok = await departmentsStore.reorder(ids);
  if (!ok) {
    notify(departmentsStore.error || t('departments.title'), 'error');
  }
}

onMounted(() => {
  departmentsStore.fetchAll();
  loadWebexRooms();
  loadJiraProjects();
});
</script>
