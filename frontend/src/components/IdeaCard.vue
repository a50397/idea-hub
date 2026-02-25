<template>
  <v-card>
    <v-card-title class="d-flex align-center">
      <span class="flex-grow-1">{{ idea.title }}</span>
      <v-chip :color="statusColors[idea.status]" size="small">
        {{ $t(`status.${statusKeyMap[idea.status]}`) }}
      </v-chip>
    </v-card-title>
    <v-card-subtitle>
      <v-chip size="small" variant="outlined" class="mr-2">
        {{ $t(`effort.${effortKeyMap[idea.effort]}`) }}
      </v-chip>
      <span class="text-caption">{{ $t('ideas.submittedBy') }} {{ idea.submitter.name }}</span>
    </v-card-subtitle>
    <v-card-text>
      <p class="mb-2">{{ truncate(idea.description, 150) }}</p>
      <div v-if="idea.tags.length" class="mt-2">
        <v-chip v-for="tag in idea.tags" :key="tag" size="x-small" class="mr-1">
          {{ tag }}
        </v-chip>
      </div>
      <v-divider class="my-3"></v-divider>
      <div class="text-caption">
        <div v-if="idea.approver">
          <v-icon size="small">mdi-check</v-icon>
          {{ $t('ideas.approvedBy') }} {{ idea.approver.name }}
        </div>
        <div v-if="idea.assignee">
          <v-icon size="small">mdi-account</v-icon>
          {{ $t('ideas.assignedTo') }} {{ idea.assignee.name }}
        </div>
        <div>
          <v-icon size="small">mdi-calendar</v-icon>
          {{ formatDate(idea.submittedAt) }}
        </div>
      </div>
    </v-card-text>
    <v-card-actions>
      <v-btn
        variant="text"
        color="primary"
        @click="$emit('view', idea.id)"
      >
        {{ $t('ideas.viewDetails') }}
      </v-btn>
      <v-spacer></v-spacer>
      <slot name="actions"></slot>
    </v-card-actions>
  </v-card>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { Idea } from '../types';
import { IdeaStatus, Effort, statusColors } from '../types';

const { locale } = useI18n();

const statusKeyMap: Record<IdeaStatus, string> = {
  [IdeaStatus.SUBMITTED]: 'submitted',
  [IdeaStatus.APPROVED]: 'approved',
  [IdeaStatus.IN_PROGRESS]: 'inProgress',
  [IdeaStatus.DONE]: 'done',
  [IdeaStatus.REJECTED]: 'rejected',
};

const effortKeyMap: Record<Effort, string> = {
  [Effort.LESS_THAN_ONE_DAY]: 'lessThanOneDay',
  [Effort.ONE_TO_THREE_DAYS]: 'oneToThreeDays',
  [Effort.MORE_THAN_THREE_DAYS]: 'moreThanThreeDays',
};

defineProps<{
  idea: Idea;
}>();

defineEmits<{
  view: [id: string];
}>();

function truncate(text: string, length: number): string {
  if (text.length <= length) return text;
  return text.substring(0, length) + '...';
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const loc = locale.value === 'sk' ? 'sk-SK' : 'en-US';
  return date.toLocaleDateString(loc, { year: 'numeric', month: 'short', day: 'numeric' });
}
</script>
