<template>
  <v-container fluid class="page-container">
    <h1 class="text-h4 page-title">{{ $t('myIdeas.title') }}</h1>
    <p class="text-subtitle-1 mb-4">{{ $t('myIdeas.subtitle') }}</p>

    <v-row class="mb-4">
      <v-col cols="12" sm="4" md="3">
        <v-select
          v-model="statusFilter"
          :items="statusOptions"
          :label="$t('myIdeas.filterByStatus')"
          variant="outlined"
          density="compact"
          clearable
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
        {{ $t('myIdeas.noIdeas') }}
      </v-alert>
    </div>
  </v-container>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ideasApi } from '../api/ideas';
import { useAuthStore } from '../stores/auth';
import { IdeaStatus } from '../types';
import type { Idea } from '../types';
import IdeaCard from '../components/IdeaCard.vue';

const { t } = useI18n();
const router = useRouter();
const authStore = useAuthStore();
const loading = ref(true);
const ideas = ref<Idea[]>([]);
const statusFilter = ref<IdeaStatus | null>(null);

const statusOptions = computed(() => [
  { title: t('status.submitted'), value: IdeaStatus.SUBMITTED },
  { title: t('status.approved'), value: IdeaStatus.APPROVED },
  { title: t('status.inProgress'), value: IdeaStatus.IN_PROGRESS },
  { title: t('status.done'), value: IdeaStatus.DONE },
  { title: t('status.rejected'), value: IdeaStatus.REJECTED },
]);

async function loadIdeas() {
  loading.value = true;
  try {
    const filters: any = {};
    if (statusFilter.value) {
      filters.status = statusFilter.value;
    }
    if (authStore.user?.id) {
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
});
</script>
