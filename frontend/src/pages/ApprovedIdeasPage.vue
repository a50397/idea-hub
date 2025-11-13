<template>
  <v-container fluid class="page-container">
    <h1 class="text-h4 page-title">{{ t('approvedIdeas.title') }}</h1>
    <p class="text-subtitle-1 mb-4">{{ t('approvedIdeas.description') }}</p>

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
                color="success"
                variant="elevated"
                @click="claimIdea(idea.id)"
                :loading="claimingId === idea.id"
              >
                {{ t('approvedIdeas.claimAndStart') }}
              </v-btn>
            </template>
          </IdeaCard>
        </v-col>
      </v-row>
      <v-alert v-else type="info">
        {{ t('approvedIdeas.noIdeas') }}
      </v-alert>
    </div>

    <v-snackbar v-model="snackbar" :color="snackbarColor">
      {{ snackbarText }}
    </v-snackbar>
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ideasApi } from '../api/ideas';
import { IdeaStatus } from '../types';
import type { Idea } from '../types';
import IdeaCard from '../components/IdeaCard.vue';

const router = useRouter();
const { t } = useI18n();
const loading = ref(true);
const ideas = ref<Idea[]>([]);
const claimingId = ref<string | null>(null);
const snackbar = ref(false);
const snackbarText = ref('');
const snackbarColor = ref('success');

async function loadIdeas() {
  loading.value = true;
  try {
    ideas.value = await ideasApi.getAll({ status: IdeaStatus.APPROVED });
  } catch (error) {
    console.error('Error loading ideas:', error);
  } finally {
    loading.value = false;
  }
}

function viewIdea(id: string) {
  router.push({ name: 'IdeaDetail', params: { id } });
}

async function claimIdea(id: string) {
  claimingId.value = id;
  try {
    await ideasApi.claim(id);
    snackbarText.value = t('approvedIdeas.claimSuccess');
    snackbarColor.value = 'success';
    snackbar.value = true;
    await loadIdeas();
  } catch (error: any) {
    snackbarText.value = error.response?.data?.error || t('approvedIdeas.claimError');
    snackbarColor.value = 'error';
    snackbar.value = true;
  } finally {
    claimingId.value = null;
  }
}

onMounted(() => {
  loadIdeas();
});
</script>
