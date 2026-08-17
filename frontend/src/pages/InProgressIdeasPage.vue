<template>
  <v-container fluid class="page-container">
    <h1 class="text-h4 page-title">{{ $t('inProgress.title') }}</h1>

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
              <v-btn
                v-if="idea.assigneeId === authStore.user?.id"
                color="primary"
                variant="elevated"
                @click="showCompleteDialog(idea)"
              >
                {{ $t('inProgress.markComplete') }}
              </v-btn>
            </template>
          </IdeaCard>
        </v-col>
      </v-row>
      <v-alert v-else type="info" variant="tonal">
        {{ $t('inProgress.noIdeas') }}
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

    <v-dialog v-model="completeDialog" max-width="500">
      <v-card>
        <v-card-title>{{ $t('inProgress.completeTitle') }}</v-card-title>
        <v-card-text>
          <p class="mb-4">{{ $t('inProgress.completeConfirm') }}</p>
          <v-textarea
            v-model="completeNote"
            :label="$t('inProgress.completionNotes')"
            variant="outlined"
            rows="3"
          ></v-textarea>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="completeDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="primary" @click="completeIdea" :loading="completing">
            {{ $t('inProgress.complete') }}
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
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '../stores/auth';
import { useDepartmentsStore } from '../stores/departments';
import { ideasApi } from '../api/ideas';
import { IdeaStatus, MAX_PAGE_LIMIT } from '../types';
import type { Idea } from '../types';
import IdeaCard from '../components/IdeaCard.vue';
import { clampedPage } from '../utils/pagination';

const { t } = useI18n();
const router = useRouter();
const authStore = useAuthStore();
const departmentsStore = useDepartmentsStore();
const loading = ref(true);
const ideas = ref<Idea[]>([]);
const page = ref(1);
const lastLoadedPage = ref(1);
const totalPages = ref(0);
const departmentFilter = ref<string | null>(null);
const completeDialog = ref(false);
const completeNote = ref('');
const completing = ref(false);
const selectedIdea = ref<Idea | null>(null);
const snackbar = ref(false);
const snackbarText = ref('');
const snackbarColor = ref('success');

const departmentOptions = computed(() => [
  { title: t('ideas.allDepartments'), value: null },
  ...departmentsStore.sortedByOrder.map((d) => ({ title: d.name, value: d.id })),
]);

async function loadIdeas() {
  loading.value = true;
  try {
    // Ideas are readable org-wide by every role, so no submitter scoping here.
    const filters: any = { status: IdeaStatus.IN_PROGRESS, limit: MAX_PAGE_LIMIT, page: page.value };
    if (departmentFilter.value) {
      filters.departmentId = departmentFilter.value;
    }
    const { data, pagination } = await ideasApi.getAll(filters);
    // Landing past the last page (the page's last item was completed or filtered
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

function showCompleteDialog(idea: Idea) {
  selectedIdea.value = idea;
  completeNote.value = '';
  completeDialog.value = true;
}

async function completeIdea() {
  if (!selectedIdea.value) return;

  completing.value = true;
  try {
    await ideasApi.complete(selectedIdea.value.id, { note: completeNote.value });
    snackbarText.value = t('inProgress.completeSuccess');
    snackbarColor.value = 'success';
    snackbar.value = true;
    completeDialog.value = false;
    await loadIdeas();
  } catch (error: any) {
    snackbarText.value = error.response?.data?.error || 'Failed to complete idea';
    snackbarColor.value = 'error';
    snackbar.value = true;
  } finally {
    completing.value = false;
  }
}

onMounted(() => {
  loadIdeas();
  departmentsStore.fetchAll();
});
</script>
