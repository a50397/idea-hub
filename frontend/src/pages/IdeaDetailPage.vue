<template>
  <v-container fluid class="page-container">
    <v-btn @click="$router.back()" prepend-icon="mdi-arrow-left" variant="text" class="mb-4">
      Back
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
                {{ statusLabels[idea.status] }}
              </v-chip>
              <v-chip variant="outlined">
                {{ effortLabels[idea.effort] }}
              </v-chip>
            </v-card-subtitle>
            <v-card-text>
              <div class="mb-4">
                <h3 class="text-h6 mb-2">Description</h3>
                <p>{{ idea.description }}</p>
              </div>
              <v-divider class="my-4"></v-divider>
              <div class="mb-4">
                <h3 class="text-h6 mb-2">Benefits</h3>
                <p>{{ idea.benefits }}</p>
              </div>
              <v-divider class="my-4"></v-divider>
              <div v-if="idea.tags.length" class="mb-4">
                <h3 class="text-h6 mb-2">Tags</h3>
                <v-chip v-for="tag in idea.tags" :key="tag" class="mr-1">
                  {{ tag }}
                </v-chip>
              </div>
            </v-card-text>
          </v-card>

          <v-card class="mt-4" v-if="idea.events && idea.events.length">
            <v-card-title>Activity Timeline</v-card-title>
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
                    <strong>{{ event.type }}</strong> by {{ event.byUser.name }}
                    <p v-if="event.note" class="text-caption mt-1">{{ event.note }}</p>
                  </div>
                </v-timeline-item>
              </v-timeline>
            </v-card-text>
          </v-card>
        </v-col>

        <v-col cols="12" md="4">
          <v-card>
            <v-card-title>Details</v-card-title>
            <v-card-text>
              <v-list density="compact">
                <v-list-item>
                  <v-list-item-title>Submitted By</v-list-item-title>
                  <v-list-item-subtitle>{{ idea.submitter.name }}</v-list-item-subtitle>
                </v-list-item>
                <v-list-item v-if="idea.approver">
                  <v-list-item-title>Approved By</v-list-item-title>
                  <v-list-item-subtitle>{{ idea.approver.name }}</v-list-item-subtitle>
                </v-list-item>
                <v-list-item v-if="idea.assignee">
                  <v-list-item-title>Assigned To</v-list-item-title>
                  <v-list-item-subtitle>{{ idea.assignee.name }}</v-list-item-subtitle>
                </v-list-item>
                <v-divider class="my-2"></v-divider>
                <v-list-item>
                  <v-list-item-title>Submitted</v-list-item-title>
                  <v-list-item-subtitle>{{ formatDate(idea.submittedAt) }}</v-list-item-subtitle>
                </v-list-item>
                <v-list-item v-if="idea.approvedAt">
                  <v-list-item-title>Approved</v-list-item-title>
                  <v-list-item-subtitle>{{ formatDate(idea.approvedAt) }}</v-list-item-subtitle>
                </v-list-item>
                <v-list-item v-if="idea.startedAt">
                  <v-list-item-title>Started</v-list-item-title>
                  <v-list-item-subtitle>{{ formatDate(idea.startedAt) }}</v-list-item-subtitle>
                </v-list-item>
                <v-list-item v-if="idea.completedAt">
                  <v-list-item-title>Completed</v-list-item-title>
                  <v-list-item-subtitle>{{ formatDate(idea.completedAt) }}</v-list-item-subtitle>
                </v-list-item>
              </v-list>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </div>

    <v-alert v-else type="error">
      Idea not found
    </v-alert>
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { ideasApi } from '../api/ideas';
import { statusLabels, statusColors, effortLabels } from '../types';
import type { Idea } from '../types';

const route = useRoute();
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
