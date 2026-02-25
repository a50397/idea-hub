<template>
  <v-container fluid class="page-container">
    <h1 class="text-h4 page-title">{{ $t('review.title') }}</h1>
    <p class="text-subtitle-1 mb-4">{{ $t('review.subtitle') }}</p>

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
                {{ $t(`effort.${effortKeyMap[idea.effort]}`) }}
              </v-chip>
              <span>{{ $t('ideas.submittedBy') }} {{ idea.submitter.name }} — {{ formatDate(idea.submittedAt) }}</span>
            </v-card-subtitle>
            <v-card-text>
              <div class="mb-3">
                <strong>{{ $t('ideas.description') }}:</strong>
                <p>{{ idea.description }}</p>
              </div>
              <div class="mb-3">
                <strong>{{ $t('ideas.benefits') }}:</strong>
                <p>{{ idea.benefits }}</p>
              </div>
              <div v-if="idea.tags.length">
                <strong>{{ $t('ideas.tags') }}:</strong>
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
                {{ $t('review.approve') }}
              </v-btn>
              <v-btn
                color="error"
                variant="outlined"
                @click="showRejectDialog(idea)"
                prepend-icon="mdi-close"
              >
                {{ $t('review.reject') }}
              </v-btn>
              <v-spacer></v-spacer>
              <v-btn @click="viewIdea(idea.id)">
                {{ $t('ideas.viewFullDetails') }}
              </v-btn>
            </v-card-actions>
          </v-card>
        </v-col>
      </v-row>
      <v-alert v-else type="info">
        {{ $t('review.noPending') }}
      </v-alert>
    </div>

    <v-dialog v-model="approveDialog" max-width="500">
      <v-card>
        <v-card-title>{{ $t('review.approveTitle') }}</v-card-title>
        <v-card-text>
          <p class="mb-4">{{ $t('review.approveConfirm', { title: selectedIdea?.title }) }}</p>
          <v-textarea
            v-model="reviewNote"
            :label="$t('review.approvalNotes')"
            variant="outlined"
            rows="3"
          ></v-textarea>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="approveDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="success" @click="approveIdea" :loading="processing">
            {{ $t('review.approve') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="rejectDialog" max-width="500">
      <v-card>
        <v-card-title>{{ $t('review.rejectTitle') }}</v-card-title>
        <v-card-text>
          <p class="mb-4">{{ $t('review.rejectConfirm', { title: selectedIdea?.title }) }}</p>
          <v-textarea
            v-model="reviewNote"
            :label="$t('review.rejectionReason')"
            variant="outlined"
            rows="3"
          ></v-textarea>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="rejectDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="error" @click="rejectIdea" :loading="processing">
            {{ $t('review.reject') }}
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
import { IdeaStatus, Effort } from '../types';
import type { Idea } from '../types';

const { t, locale } = useI18n();
const router = useRouter();
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

const effortKeyMap: Record<Effort, string> = {
  [Effort.LESS_THAN_ONE_DAY]: 'lessThanOneDay',
  [Effort.ONE_TO_THREE_DAYS]: 'oneToThreeDays',
  [Effort.MORE_THAN_THREE_DAYS]: 'moreThanThreeDays',
};

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
  const loc = locale.value === 'sk' ? 'sk-SK' : 'en-US';
  return date.toLocaleDateString(loc, { year: 'numeric', month: 'short', day: 'numeric' });
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
    snackbarText.value = t('review.approveSuccess');
    snackbarColor.value = 'success';
    snackbar.value = true;
    approveDialog.value = false;
    await loadIdeas();
  } catch (error: any) {
    snackbarText.value = error.response?.data?.error || 'Failed to approve idea';
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
    snackbarText.value = t('review.rejectSuccess');
    snackbarColor.value = 'info';
    snackbar.value = true;
    rejectDialog.value = false;
    await loadIdeas();
  } catch (error: any) {
    snackbarText.value = error.response?.data?.error || 'Failed to reject idea';
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
