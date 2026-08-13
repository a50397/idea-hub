<template>
  <v-card>
    <v-card-title class="d-flex align-center">
      <span class="flex-grow-1 text-truncate card-title-text">{{ idea.title }}</span>
      <!-- The raw Jira status is remote-controlled text (up to 255 chars): cap and
           ellipsize it so it can never squeeze the title to nothing or push the
           canonical status chip out of the clipped title row (deep-review fix). -->
      <v-chip
        v-if="idea.jiraStatus"
        :color="jiraStatusColor"
        size="small"
        variant="tonal"
        class="mr-2 jira-status-chip"
      >
        <span class="text-truncate">{{ idea.jiraStatus }}</span>
      </v-chip>
      <v-chip :color="statusColors[idea.status]" size="small" class="flex-shrink-0">
        {{ $t(`status.${statusKeyMap[idea.status]}`) }}
      </v-chip>
    </v-card-title>
    <v-card-subtitle>
      <v-chip size="small" variant="outlined" class="mr-2">
        {{ $t(`effort.${effortKeyMap[idea.effort]}`) }}
      </v-chip>
      <v-chip v-if="idea.department" size="small" variant="tonal" color="primary" class="mr-2">
        {{ idea.department.name }}
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
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Idea } from '../types';
import { IdeaStatus, Effort, statusColors, jiraCategoryColors } from '../types';

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

const props = defineProps<{
  idea: Idea;
}>();

defineEmits<{
  view: [id: string];
}>();

// Colored by Jira's status CATEGORY (new/indeterminate/done); a raw status name with
// no (yet) known category — e.g. right after dispatch, before the first poll —
// falls back to a neutral color rather than guessing.
const jiraStatusColor = computed(() =>
  props.idea.jiraStatusCategory ? jiraCategoryColors[props.idea.jiraStatusCategory] : 'default'
);

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

<style scoped>
/* The title is a flex item: without min-width:0 it refuses to shrink below its
   content and text-truncate never engages. */
.card-title-text {
  min-width: 0;
}
/* Cap the remote-controlled raw-status chip; the inner span carries text-truncate,
   and the chip's own content wrapper must be allowed to shrink for the ellipsis to
   engage. */
.jira-status-chip {
  max-width: 10rem;
}
.jira-status-chip :deep(.v-chip__content) {
  min-width: 0;
  overflow: hidden;
}
</style>
