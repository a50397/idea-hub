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
          @update:model-value="loadIdeas"
        ></v-select>
      </v-col>
    </v-row>

    <v-row v-if="loading">
      <v-col cols="12" class="text-center">
        <v-progress-circular indeterminate color="primary"></v-progress-circular>
      </v-col>
    </v-row>

    <div v-else>
      <v-alert v-if="truncated" type="info" variant="tonal" density="compact" class="mb-4">
        {{ $t('ideas.showingFirst', { shown: ideas.length, total }) }}
      </v-alert>
      <v-row v-if="ideas.length">
        <v-col v-for="idea in ideas" :key="idea.id" cols="12" md="6" lg="4">
          <IdeaCard :idea="idea" @view="viewIdea" />
        </v-col>
      </v-row>
      <v-alert v-else type="info" variant="tonal">
        {{ $t('completed.noIdeas') }}
      </v-alert>
    </div>
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

const { t } = useI18n();
const router = useRouter();
const departmentsStore = useDepartmentsStore();
const loading = ref(true);
const ideas = ref<Idea[]>([]);
const total = ref(0);
const departmentFilter = ref<string | null>(null);

const departmentOptions = computed(() => [
  { title: t('ideas.allDepartments'), value: null },
  ...departmentsStore.sortedByOrder.map((d) => ({ title: d.name, value: d.id })),
]);

// The server caps a page at MAX_PAGE_LIMIT, so tell the user when there is more.
const truncated = computed(() => total.value > ideas.value.length);

async function loadIdeas() {
  loading.value = true;
  try {
    // Ideas are readable org-wide by every role, so no submitter scoping here.
    const filters: any = { status: IdeaStatus.DONE, limit: MAX_PAGE_LIMIT };
    if (departmentFilter.value) {
      filters.departmentId = departmentFilter.value;
    }
    const { data, pagination } = await ideasApi.getAll(filters);
    ideas.value = data;
    total.value = pagination.total;
  } catch (error) {
    console.error('Error loading ideas:', error);
  } finally {
    loading.value = false;
  }
}

function viewIdea(id: string) {
  router.push({ name: 'IdeaDetail', params: { id } });
}

onMounted(() => {
  loadIdeas();
  departmentsStore.fetchAll();
});
</script>
