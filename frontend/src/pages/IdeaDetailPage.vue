<template>
  <v-container fluid class="page-container">
    <v-btn @click="$router.back()" prepend-icon="mdi-arrow-left" variant="text" class="mb-4">
      {{ t('ideaDetail.back') }}
    </v-btn>

    <v-row v-if="loading">
      <v-col cols="12" class="text-center">
        <v-progress-circular indeterminate color="primary"></v-progress-circular>
      </v-col>
    </v-row>

    <div v-else-if="idea">
      <v-row>
        <v-col cols="12" md="8">
          <v-card>
            <v-card-title class="text-h5">
              {{ idea.title }}
            </v-card-title>
            <v-card-subtitle>
              <v-chip :color="statusColors[idea.status]" class="mr-2">
                {{ t(`status.${idea.status}`) }}
              </v-chip>
              <v-chip variant="outlined">
                {{ t(`effort.${idea.effort}`) }}
              </v-chip>
            </v-card-subtitle>
            <v-card-text>
              <div class="mb-4">
                <h3 class="text-h6 mb-2">{{ t('ideaDetail.description') }}</h3>
                <p>{{ idea.description }}</p>
              </div>
              <v-divider class="my-4"></v-divider>
              <div class="mb-4">
                <h3 class="text-h6 mb-2">{{ t('ideaDetail.benefits') }}</h3>
                <p>{{ idea.benefits }}</p>
              </div>
              <v-divider class="my-4"></v-divider>
              <div v-if="idea.tags.length" class="mb-4">
                <h3 class="text-h6 mb-2">{{ t('ideaDetail.tags') }}</h3>
                <v-chip v-for="tag in idea.tags" :key="tag" class="mr-1">
                  {{ tag }}
                </v-chip>
              </div>
            </v-card-text>
          </v-card>

          <v-card class="mt-4" v-if="idea.events && idea.events.length">
            <v-card-title>{{ t('ideaDetail.timeline') }}</v-card-title>
            <v-card-text>
              <v-timeline side="end" density="compact">
                <v-timeline-item
                  v-for="event in idea.events"
                  :key="event.id"
                  size="small"
                  dot-color="primary"
                >
                  <template v-slot:opposite>
                    <div class="text-caption">
                      {{ formatDateTime(event.timestamp) }}
                    </div>
                  </template>
                  <div>
                    <strong>{{ t(`eventTypes.${event.type}`) }}</strong> {{ event.byUser.name }}
                    <p v-if="event.note" class="text-caption mt-1">{{ event.note }}</p>
                  </div>
                </v-timeline-item>
              </v-timeline>
            </v-card-text>
          </v-card>
        </v-col>

        <v-col cols="12" md="4">
          <v-card>
            <v-card-title>{{ t('ideaDetail.details') }}</v-card-title>
            <v-card-text>
              <v-list density="compact">
                <v-list-item>
                  <v-list-item-title>{{ t('ideaDetail.submittedBy') }}</v-list-item-title>
                  <v-list-item-subtitle>{{ idea.submitter.name }}</v-list-item-subtitle>
                </v-list-item>
                <v-list-item v-if="idea.approver">
                  <v-list-item-title>{{ t('ideaDetail.approvedBy') }}</v-list-item-title>
                  <v-list-item-subtitle>{{ idea.approver.name }}</v-list-item-subtitle>
                </v-list-item>
                <v-list-item v-if="idea.assignee">
                  <v-list-item-title>{{ t('ideaDetail.assignedTo') }}</v-list-item-title>
                  <v-list-item-subtitle>{{ idea.assignee.name }}</v-list-item-subtitle>
                </v-list-item>
                <v-divider class="my-2"></v-divider>
                <v-list-item>
                  <v-list-item-title>{{ t('ideaDetail.submittedAt') }}</v-list-item-title>
                  <v-list-item-subtitle>{{ formatDate(idea.submittedAt) }}</v-list-item-subtitle>
                </v-list-item>
                <v-list-item v-if="idea.approvedAt">
                  <v-list-item-title>{{ t('ideaDetail.approvedAt') }}</v-list-item-title>
                  <v-list-item-subtitle>{{ formatDate(idea.approvedAt) }}</v-list-item-subtitle>
                </v-list-item>
                <v-list-item v-if="idea.startedAt">
                  <v-list-item-title>{{ t('ideaDetail.startedAt') }}</v-list-item-title>
                  <v-list-item-subtitle>{{ formatDate(idea.startedAt) }}</v-list-item-subtitle>
                </v-list-item>
                <v-list-item v-if="idea.completedAt">
                  <v-list-item-title>{{ t('ideaDetail.completedAt') }}</v-list-item-title>
                  <v-list-item-subtitle>{{ formatDate(idea.completedAt) }}</v-list-item-subtitle>
                </v-list-item>
              </v-list>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </div>

    <v-alert v-else type="error">
      {{ t('common.noData') }}
    </v-alert>
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ideasApi } from '../api/ideas';
import { statusColors } from '../types';
import type { Idea } from '../types';

const route = useRoute();
const { t } = useI18n();
const loading = ref(true);
const idea = ref<Idea | null>(null);

async function loadIdea() {
  loading.value = true;
  try {
    const id = route.params.id as string;
    idea.value = await ideasApi.getOne(id);
  } catch (error) {
    console.error('Error loading idea:', error);
  } finally {
    loading.value = false;
  }
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

onMounted(() => {
  loadIdea();
});
</script>
