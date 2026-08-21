<template>
  <v-container fluid class="page-container">
    <h1 class="text-h4 page-title">{{ $t('approved.title') }}</h1>
    <p class="text-subtitle-1 mb-4">{{ $t('approved.subtitle') }}</p>

    <v-row class="mb-4">
      <v-col cols="12" sm="4" md="3">
        <v-select
          v-model="departmentFilter"
          :items="departmentOptions"
          :label="$t('ideas.filterByDepartment')"
          variant="outlined"
          density="compact"
          @update:model-value="onFilterChange"
        ></v-select>
      </v-col>
    </v-row>

    <v-row v-if="loading">
      <v-col cols="12" class="text-center">
        <v-progress-circular indeterminate color="primary"></v-progress-circular>
      </v-col>
    </v-row>

    <div v-else>
      <v-row v-if="ideas.length">
        <v-col v-for="idea in ideas" :key="idea.id" cols="12" md="6" lg="4">
          <IdeaCard :idea="idea" @view="viewIdea">
            <template #actions>
              <!-- Once dispatched, the button disappears and IdeaCard's own linked
                   Jira chip (title row) takes over as the durable way back to the
                   issue — Safari and strict-Firefox popup blockers can swallow the
                   post-await window.open on dispatch, and the snackbar fallback
                   expires. -->
              <v-btn
                v-if="canCreateJiraTask(idea)"
                color="success"
                variant="elevated"
                @click="openDispatchDialog(idea)"
                :loading="creatingId === idea.id"
              >
                {{ $t('ideas.createJiraTask') }}
              </v-btn>
            </template>
          </IdeaCard>
        </v-col>
      </v-row>
      <v-alert v-else type="info" variant="tonal">
        {{ $t('approved.noIdeas') }}
      </v-alert>
    </div>

    <!-- Outside the loading branch: unmounting it every fetch would drop
         keyboard focus; disabling instead also blocks mid-flight page clicks. -->
    <v-pagination
      v-if="totalPages > 1"
      v-model="page"
      :length="totalPages"
      :disabled="loading"
      class="mt-4"
      @update:model-value="onPageChange"
    ></v-pagination>

    <!-- Dispatch dialog: the target project, PRESELECTED with what the backend
         would resolve (department override ?? installation default) and required —
         every dispatch is explicit. The projects list is fetched FRESH on every
         open so it always reflects the currently saved credentials. -->
    <v-dialog v-model="dispatchDialog" max-width="500">
      <v-card>
        <v-card-title>{{ $t('ideas.createJiraTask') }}</v-card-title>
        <v-card-text>
          <p class="mb-4">{{ $t('ideas.jiraProjectPrompt', { title: dispatchIdea?.title }) }}</p>
          <v-combobox
            :model-value="dispatchProjectKey"
            @update:model-value="onDispatchProjectInput"
            @keydown.enter.prevent
            :label="$t('ideas.jiraProjectLabel')"
            variant="outlined"
            clearable
            :loading="dispatchProjectsLoading"
            :items="dispatchProjectItems"
            item-title="title"
            item-value="value"
            :return-object="false"
            :hint="dispatchProjectsHint"
            persistent-hint
            :error-messages="dispatchProjectError"
          ></v-combobox>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="dispatchDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn
            color="success"
            @click="confirmCreateJiraTask"
            :loading="creatingId !== null"
            :disabled="!!dispatchProjectError || !dispatchProjectKey.trim()"
          >
            {{ $t('ideas.createJiraTask') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar" :color="snackbarColor" :timeout="8000">
      <div>{{ snackbarText }}</div>
      <a v-if="jiraLinkUrl" :href="jiraLinkUrl" target="_blank" rel="noopener" class="d-block mt-1 text-white">
        {{ jiraLinkUrl }}
      </a>
    </v-snackbar>
  </v-container>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ideasApi } from '../api/ideas';
import { jiraSettingsApi } from '../api/jiraSettings';
import { IdeaStatus, MAX_PAGE_LIMIT } from '../types';
import type { Idea, JiraProject } from '../types';
import IdeaCard from '../components/IdeaCard.vue';
import { useAuthStore } from '../stores/auth';
import { useDepartmentsStore } from '../stores/departments';
import { useOptionsStore } from '../stores/options';
import { clampedPage } from '../utils/pagination';

const { t, te } = useI18n();
const router = useRouter();
const authStore = useAuthStore();
const departmentsStore = useDepartmentsStore();
const optionsStore = useOptionsStore();
const loading = ref(true);
const ideas = ref<Idea[]>([]);
const creatingId = ref<string | null>(null);
const page = ref(1);
const lastLoadedPage = ref(1);
const totalPages = ref(0);
const departmentFilter = ref<string | null>(null);
const snackbar = ref(false);
const snackbarText = ref('');
const snackbarColor = ref('success');
// Set alongside the snackbar on a successful dispatch that DID carry a browse URL;
// null otherwise (including every failure) so the fallback link never lingers.
const jiraLinkUrl = ref<string | null>(null);

// --- dispatch dialog (optional explicit target project) ----------------------
const dispatchDialog = ref(false);
const dispatchIdea = ref<Idea | null>(null);
const dispatchProjectKey = ref('');
const dispatchProjects = ref<JiraProject[]>([]);
const dispatchProjectsLoading = ref(false);
const dispatchProjectsUnavailable = ref(false);

const dispatchProjectItems = computed(() =>
  dispatchProjects.value.map((p) => ({ title: `${p.key} — ${p.name}`, value: p.key }))
);
const dispatchProjectsHint = computed(() =>
  dispatchProjectsUnavailable.value ? t('ideas.jiraProjectUnavailable') : t('ideas.jiraProjectHint')
);
// Client-side mirror of the backend key rule (empty = "no choice", always valid).
const dispatchProjectError = computed(() => {
  const v = dispatchProjectKey.value.trim();
  if (v === '') return '';
  return v.length <= 32 && /^[A-Za-z][A-Za-z0-9_]*$/.test(v) ? '' : t('ideas.jiraProjectInvalid');
});

function onDispatchProjectInput(v: string | null) {
  dispatchProjectKey.value = (v ?? '').toUpperCase();
}

function openDispatchDialog(idea: Idea) {
  dispatchIdea.value = idea;
  dispatchProjectKey.value = '';
  dispatchDialog.value = true;
  // Fetch FRESH on every open — the visible projects follow the CURRENTLY saved
  // credentials (an admin may have re-pointed the integration since the last look).
  loadDispatchProjects();
  loadDispatchTarget(idea.id);
}

// Preselect the RESOLVED target (department override ?? default) so the field
// always carries an explicit value; best-effort, and it never clobbers what the
// user already typed.
async function loadDispatchTarget(ideaId: string) {
  try {
    const { projectKey } = await ideasApi.getJiraTarget(ideaId);
    // A LATE response from a previously opened idea's dialog must be discarded:
    // without this, cancelling idea A and quickly opening idea B could prefill
    // B's dialog with A's department project (deep-review fix).
    if (dispatchIdea.value?.id !== ideaId) return;
    if (projectKey && dispatchProjectKey.value === '') {
      dispatchProjectKey.value = projectKey;
    }
  } catch {
    // No preselection then — the user picks or types the key.
  }
}

async function loadDispatchProjects() {
  dispatchProjectsLoading.value = true;
  try {
    const { projects, reason } = await jiraSettingsApi.getProjects();
    dispatchProjects.value = projects;
    dispatchProjectsUnavailable.value = reason !== undefined;
  } catch {
    dispatchProjects.value = [];
    dispatchProjectsUnavailable.value = true;
  } finally {
    dispatchProjectsLoading.value = false;
  }
}

const departmentOptions = computed(() => [
  { title: t('ideas.allDepartments'), value: null },
  ...departmentsStore.sortedByOrder.map((d) => ({ title: d.name, value: d.id })),
]);

function canCreateJiraTask(idea: Idea): boolean {
  return authStore.isPowerUser && optionsStore.jiraEnabled && !idea.jiraSyncActive;
}

async function loadIdeas() {
  loading.value = true;
  try {
    // Ideas are readable org-wide by every role, so no submitter scoping here.
    const filters: any = { status: IdeaStatus.APPROVED, limit: MAX_PAGE_LIMIT, page: page.value };
    if (departmentFilter.value) {
      filters.departmentId = departmentFilter.value;
    }
    const { data, pagination } = await ideasApi.getAll(filters);
    // Landing past the last page (the page's last item moved on or was filtered
    // away) would show an empty view — snap back into the real range.
    const snap = clampedPage(data.length, page.value, pagination.totalPages);
    if (snap !== null) {
      page.value = snap;
      return await loadIdeas();
    }
    ideas.value = data;
    totalPages.value = pagination.totalPages;
    lastLoadedPage.value = page.value;
  } catch (error) {
    console.error('Error loading ideas:', error);
    // The pager's v-model already advanced; the rows on screen did not. Revert
    // so the highlighted page stays truthful and re-clicking it works again.
    page.value = lastLoadedPage.value;
    snackbarText.value = t('ideas.loadFailed');
    snackbarColor.value = 'error';
    snackbar.value = true;
  } finally {
    loading.value = false;
  }
}

function onFilterChange() {
  page.value = 1;
  loadIdeas();
}

function onPageChange() {
  loadIdeas();
  window.scrollTo({ top: 0 });
}

function viewIdea(id: string) {
  router.push({ name: 'IdeaDetail', params: { id } });
}

async function confirmCreateJiraTask() {
  const idea = dispatchIdea.value;
  const chosenKey = dispatchProjectKey.value.trim();
  if (!idea || dispatchProjectError.value || !chosenKey) return;
  creatingId.value = idea.id;
  try {
    const result = await ideasApi.createJiraTask(idea.id, chosenKey);
    dispatchDialog.value = false;
    // Kept synchronous in this promise chain (no extra await before it) so the
    // browser still associates the new tab with the click gesture as closely as
    // possible; a popup blocker may still swallow it, which is exactly why the
    // snackbar below always also carries a clickable fallback when a URL exists.
    if (result.jiraBrowseUrl) {
      window.open(result.jiraBrowseUrl, '_blank', 'noopener');
    }
    jiraLinkUrl.value = result.jiraBrowseUrl ?? null;
    snackbarText.value = t('ideas.createJiraTaskSuccess', { key: result.jiraIssueKey ?? '' });
    snackbarColor.value = 'success';
    snackbar.value = true;
    await loadIdeas();
  } catch (error: any) {
    jiraLinkUrl.value = null;
    snackbarText.value = jiraTaskErrorText(error);
    snackbarColor.value = 'error';
    snackbar.value = true;
  } finally {
    creatingId.value = null;
  }
}

// Localized message for a failed dispatch — the raw backend `error` string is
// English and never shown. 409/400 get dispatch-specific wordings; a 502 carries the
// closed JiraFailureReason enum, resolved through the SAME te()-guarded reason
// catalog the settings test button uses. Keep in sync with IdeaDetailPage.vue's twin.
function jiraTaskErrorText(error: any): string {
  const status = error?.response?.status;
  if (status === 409) return t('ideas.createJiraTaskConflict');
  if (status === 400) return t('ideas.createJiraTaskBadState');
  const reason = error?.response?.data?.reason;
  if (status === 502 && typeof reason === 'string') {
    const key = `jiraSettings.testReason.${reason}`;
    if (te(key)) return t(key);
  }
  return t('ideas.createJiraTaskFailed');
}

onMounted(() => {
  loadIdeas();
  departmentsStore.fetchAll();
  optionsStore.fetch();
});
</script>
