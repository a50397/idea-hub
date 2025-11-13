<template>
  <v-container fluid class="page-container">
    <h1 class="text-h4 page-title">{{ t('reviewQueue.title') }}</h1>
    <p class="text-subtitle-1 mb-4">{{ t('reviewQueue.description') }}</p>

    <v-row v-if="loading">
      <v-col cols="12" class="text-center">
        <v-progress-circular indeterminate color="primary"></v-progress-circular>
      </v-col>
    </v-row>

    <div v-else>
      <v-row v-if="ideas.length">
        <v-col v-for="idea in ideas" :key="idea.id" cols="12">
          <v-card>
            <v-card-title>{{ idea.title }}</v-card-title>
            <v-card-subtitle>
              <v-chip size="small" variant="outlined" class="mr-2">
                {{ t(`effort.${idea.effort}`) }}
              </v-chip>
              <span>{{ t('reviewQueue.submittedBy') }} {{ idea.submitter.name }} {{ t('reviewQueue.on') }} {{ formatDate(idea.submittedAt) }}</span>
            </v-card-subtitle>
            <v-card-text>
              <div class="mb-3">
                <strong>{{ t('reviewQueue.description') }}:</strong>
                <p>{{ idea.description }}</p>
              </div>
              <div class="mb-3">
                <strong>{{ t('reviewQueue.benefits') }}:</strong>
                <p>{{ idea.benefits }}</p>
              </div>
              <div v-if="idea.tags.length">
                <strong>{{ t('reviewQueue.tags') }}:</strong>
                <v-chip v-for="tag in idea.tags" :key="tag" size="small" class="mr-1 mt-1">
                  {{ tag }}
                </v-chip>
              </div>
            </v-card-text>
            <v-card-actions>
              <v-btn
                color="success"
                variant="elevated"
                @click="showApproveDialog(idea)"
                prepend-icon="mdi-check"
              >
                {{ t('reviewQueue.approveButton') }}
              </v-btn>
              <v-btn
                color="error"
                variant="outlined"
                @click="showRejectDialog(idea)"
                prepend-icon="mdi-close"
              >
                {{ t('reviewQueue.rejectButton') }}
              </v-btn>
              <v-spacer></v-spacer>
              <v-btn @click="viewIdea(idea.id)">
                {{ t('reviewQueue.viewFullDetails') }}
              </v-btn>
            </v-card-actions>
          </v-card>
        </v-col>
      </v-row>
      <v-alert v-else type="info">
        {{ t('reviewQueue.noIdeas') }}
      </v-alert>
    </div>

    <v-dialog v-model="approveDialog" max-width="500">
      <v-card>
        <v-card-title>{{ t('reviewQueue.approveDialogTitle') }}</v-card-title>
        <v-card-text>
          <p class="mb-4">{{ t('reviewQueue.approveDialogMessage', { title: selectedIdea?.title }) }}</p>
          <v-textarea
            v-model="reviewNote"
            :label="t('reviewQueue.approvalNotes')"
            variant="outlined"
            rows="3"
          ></v-textarea>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="approveDialog = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="success" @click="approveIdea" :loading="processing">
            {{ t('reviewQueue.approveButton') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="rejectDialog" max-width="500">
      <v-card>
        <v-card-title>{{ t('reviewQueue.rejectDialogTitle') }}</v-card-title>
        <v-card-text>
          <p class="mb-4">{{ t('reviewQueue.rejectDialogMessage', { title: selectedIdea?.title }) }}</p>
          <v-textarea
            v-model="reviewNote"
            :label="t('reviewQueue.rejectionReason')"
            variant="outlined"
            rows="3"
          ></v-textarea>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="rejectDialog = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="error" @click="rejectIdea" :loading="processing">
            {{ t('reviewQueue.rejectButton') }}
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
import { ideasApi } from '../api/ideas';
import { IdeaStatus } from '../types';
import type { Idea } from '../types';

const router = useRouter();
const { t } = useI18n();
const loading = ref(true);
const ideas = ref<Idea[]>([]);
const approveDialog = ref(false);
const rejectDialog = ref(false);
const reviewNote = ref('');
const processing = ref(false);
const selectedIdea = ref<Idea | null>(null);
const snackbar = ref(false);
const snackbarText = ref('');
const snackbarColor = ref('success');

async function loadIdeas() {
  loading.value = true;
  try {
    ideas.value = await ideasApi.getAll({ status: IdeaStatus.SUBMITTED });
  } catch (error) {
    console.error('Error loading ideas:', error);
  } finally {
    loading.value = false;
  }
}

function viewIdea(id: string) {
  router.push({ name: 'IdeaDetail', params: { id } });
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function showApproveDialog(idea: Idea) {
  selectedIdea.value = idea;
  reviewNote.value = '';
  approveDialog.value = true;
}

function showRejectDialog(idea: Idea) {
  selectedIdea.value = idea;
  reviewNote.value = '';
  rejectDialog.value = true;
}

async function approveIdea() {
  if (!selectedIdea.value) return;

  processing.value = true;
  try {
    await ideasApi.approve(selectedIdea.value.id, { note: reviewNote.value });
    snackbarText.value = t('reviewQueue.approveSuccess');
    snackbarColor.value = 'success';
    snackbar.value = true;
    approveDialog.value = false;
    await loadIdeas();
  } catch (error: any) {
    snackbarText.value = error.response?.data?.error || t('reviewQueue.approveError');
    snackbarColor.value = 'error';
    snackbar.value = true;
  } finally {
    processing.value = false;
  }
}

async function rejectIdea() {
  if (!selectedIdea.value) return;

  processing.value = true;
  try {
    await ideasApi.reject(selectedIdea.value.id, { note: reviewNote.value });
    snackbarText.value = t('reviewQueue.rejectSuccess');
    snackbarColor.value = 'info';
    snackbar.value = true;
    rejectDialog.value = false;
    await loadIdeas();
  } catch (error: any) {
    snackbarText.value = error.response?.data?.error || t('reviewQueue.rejectError');
    snackbarColor.value = 'error';
    snackbar.value = true;
  } finally {
    processing.value = false;
  }
}

onMounted(() => {
  loadIdeas();
});
</script>
