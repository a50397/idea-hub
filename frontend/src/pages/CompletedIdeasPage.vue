<template>
  <v-container fluid class="page-container">
    <h1 class="text-h4 page-title">{{ $t('completed.title') }}</h1>

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
          <IdeaCard :idea="idea" @view="viewIdea" />
        </v-col>
      </v-row>
      <v-alert v-else type="info" variant="tonal">
        {{ $t('completed.noIdeas') }}
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

    <v-snackbar v-model="snackbar" :color="snackbarColor">
      {{ snackbarText }}
    </v-snackbar>
  </v-container>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ideasApi } from '../api/ideas';
import { IdeaStatus, MAX_PAGE_LIMIT } from '../types';
import type { Idea } from '../types';
import IdeaCard from '../components/IdeaCard.vue';
import { useDepartmentsStore } from '../stores/departments';
import { clampedPage } from '../utils/pagination';

const { t } = useI18n();
const router = useRouter();
const departmentsStore = useDepartmentsStore();
const loading = ref(true);
const ideas = ref<Idea[]>([]);
const page = ref(1);
const lastLoadedPage = ref(1);
const totalPages = ref(0);
const departmentFilter = ref<string | null>(null);
const snackbar = ref(false);
const snackbarText = ref('');
const snackbarColor = ref('error');

const departmentOptions = computed(() => [
  { title: t('ideas.allDepartments'), value: null },
  ...departmentsStore.sortedByOrder.map((d) => ({ title: d.name, value: d.id })),
]);

async function loadIdeas() {
  loading.value = true;
  try {
    // Ideas are readable org-wide by every role, so no submitter scoping here.
    const filters: any = { status: IdeaStatus.DONE, limit: MAX_PAGE_LIMIT, page: page.value };
    if (departmentFilter.value) {
      filters.departmentId = departmentFilter.value;
    }
    const { data, pagination } = await ideasApi.getAll(filters);
    // Landing past the last page (its last item was filtered away) would show
    // an empty view — snap back into the real range.
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

onMounted(() => {
  loadIdeas();
  departmentsStore.fetchAll();
});
</script>
