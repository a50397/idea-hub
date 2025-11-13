<template>
  <v-container fluid class="page-container">
    <h1 class="text-h4 page-title">{{ t('inProgressIdeas.title') }}</h1>

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
                {{ t('inProgressIdeas.markComplete') }}
              </v-btn>
            </template>
          </IdeaCard>
        </v-col>
      </v-row>
      <v-alert v-else type="info">
        {{ t('inProgressIdeas.noIdeas') }}
      </v-alert>
    </div>

    <v-dialog v-model="completeDialog" max-width="500">
      <v-card>
        <v-card-title>{{ t('inProgressIdeas.completeDialogTitle') }}</v-card-title>
        <v-card-text>
          <p class="mb-4">{{ t('inProgressIdeas.completeDialogMessage') }}</p>
          <v-textarea
            v-model="completeNote"
            :label="t('inProgressIdeas.completionNotes')"
            variant="outlined"
            rows="3"
          ></v-textarea>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="completeDialog = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="primary" @click="completeIdea" :loading="completing">
            {{ t('inProgressIdeas.markComplete') }}
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
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '../stores/auth';
import { ideasApi } from '../api/ideas';
import { IdeaStatus } from '../types';
import type { Idea } from '../types';
import IdeaCard from '../components/IdeaCard.vue';

const router = useRouter();
const { t } = useI18n();
const authStore = useAuthStore();
const loading = ref(true);
const ideas = ref<Idea[]>([]);
const completeDialog = ref(false);
const completeNote = ref('');
const completing = ref(false);
const selectedIdea = ref<Idea | null>(null);
const snackbar = ref(false);
const snackbarText = ref('');
const snackbarColor = ref('success');

async function loadIdeas() {
  loading.value = true;
  try {
    ideas.value = await ideasApi.getAll({ status: IdeaStatus.IN_PROGRESS });
  } catch (error) {
    console.error('Error loading ideas:', error);
  } finally {
    loading.value = false;
  }
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
    snackbarText.value = t('inProgressIdeas.completeSuccess');
    snackbarColor.value = 'success';
    snackbar.value = true;
    completeDialog.value = false;
    await loadIdeas();
  } catch (error: any) {
    snackbarText.value = error.response?.data?.error || t('inProgressIdeas.completeError');
    snackbarColor.value = 'error';
    snackbar.value = true;
  } finally {
    completing.value = false;
  }
}

onMounted(() => {
  loadIdeas();
});
</script>
