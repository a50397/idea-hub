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
      <v-row v-if="ideas.length">
        <v-col v-for="idea in ideas" :key="idea.id" cols="12" md="6" lg="4">
          <IdeaCard :idea="idea" @view="viewIdea" />
        </v-col>
      </v-row>
      <v-alert v-else type="info">
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
import { IdeaStatus } from '../types';
import type { Idea } from '../types';
import IdeaCard from '../components/IdeaCard.vue';
import { useAuthStore } from '../stores/auth';
import { useDepartmentsStore } from '../stores/departments';

const { t } = useI18n();
const router = useRouter();
const departmentsStore = useDepartmentsStore();
const loading = ref(true);
const ideas = ref<Idea[]>([]);
const departmentFilter = ref<string | null>(null);

const departmentOptions = computed(() => [
  { title: t('ideas.allDepartments'), value: null },
  ...departmentsStore.sortedByOrder.map((d) => ({ title: d.name, value: d.id })),
]);

async function loadIdeas() {
  loading.value = true;
  try {
    const authStore = useAuthStore();
    const filters: any = { status: IdeaStatus.DONE };
    if (departmentFilter.value) {
      filters.departmentId = departmentFilter.value;
    }
    if (!authStore.isPowerUser && !authStore.isAdmin && authStore.user?.id) {
      filters.submitterId = authStore.user.id;
    }
    ideas.value = await ideasApi.getAll(filters);
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
