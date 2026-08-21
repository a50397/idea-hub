<template>
  <v-card>
    <v-card-title class="d-flex align-center">
      <span class="flex-grow-1 text-truncate card-title-text">{{ idea.title }}</span>
      <!-- Dispatched ideas get TWO separate chips: the issue KEY carries the link
           (an explicitly clickable-looking element), and the status chip is never
           one — a "status" that navigates to Jira reads as a misclick. The raw Jira
           status REPLACES the canonical chip once known (the two would say the same
           thing twice); it is remote-controlled text (up to 255 chars): cap and
           ellipsize it so it can never squeeze the title to nothing (deep-review
           fix). -->
      <v-chip
        v-if="showJiraLink"
        size="small"
        variant="outlined"
        class="mr-2 flex-shrink-0"
        :href="idea.jiraBrowseUrl || undefined"
        :target="idea.jiraBrowseUrl ? '_blank' : undefined"
        :rel="idea.jiraBrowseUrl ? 'noopener' : undefined"
      >
        {{ idea.jiraIssueKey }}
        <v-icon v-if="idea.jiraBrowseUrl" end size="x-small">mdi-open-in-new</v-icon>
        <!-- The key chip explains whatever the status chip cannot: before the first
             poll it is the only chip (the status is coming); on an UNMONITORED idea
             the raw status is hidden entirely (a frozen "In Progress" on an idea
             nobody watches reads as live data), so the key chip explains that too. -->
        <v-tooltip
          v-if="!idea.jiraSyncActive || !idea.jiraStatus"
          activator="parent"
          location="top"
        >{{ $t(idea.jiraSyncActive ? 'ideas.jiraSyncHint' : 'ideas.jiraFinalHint') }}</v-tooltip>
      </v-chip>
      <!-- Raw Jira status ONLY while the poller still monitors the issue — once the
           sync stops the canonical chip takes back over. -->
      <v-chip
        v-if="idea.jiraSyncActive && idea.jiraStatus"
        :color="jiraStatusColor"
        size="small"
        variant="tonal"
        class="jira-status-chip flex-shrink-0"
      >
        <span class="text-truncate">{{ idea.jiraStatus }}</span>
        <v-tooltip activator="parent" location="top">{{ $t('ideas.jiraSyncHint') }}</v-tooltip>
      </v-chip>
      <v-chip v-else :color="statusColors[idea.status]" size="small" class="flex-shrink-0">
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
        <!-- The reviewer lands in `approver` for BOTH outcomes (the reject endpoint
             writes the same field), so the label must follow the status or a
             rejected idea reads "Approved by …". -->
        <div v-if="idea.approver">
          <v-icon size="small">{{ isRejected ? 'mdi-close' : 'mdi-check' }}</v-icon>
          {{ $t(isRejected ? 'ideas.rejectedBy' : 'ideas.approvedBy') }} {{ idea.approver.name }}
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

// Gated on an active sync OR a known raw status, NOT on the bare issue key: a
// Jira-side cancellation turns sync off and nulls the raw status but leaves the
// stale key behind, and that idea is back to plain APPROVED — no chip, no dead link.
const showJiraLink = computed(() =>
  Boolean(props.idea.jiraIssueKey && (props.idea.jiraSyncActive || props.idea.jiraStatus))
);

const isRejected = computed(() => props.idea.status === IdeaStatus.REJECTED);

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
