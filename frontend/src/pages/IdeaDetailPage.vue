<template>
  <v-container fluid class="page-container">
    <v-btn @click="$router.back()" prepend-icon="mdi-arrow-left" variant="text" class="mb-4">
      {{ $t('common.back') }}
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
                {{ $t(`status.${statusKeyMap[idea.status]}`) }}
              </v-chip>
              <v-chip variant="outlined">
                {{ $t(`effort.${effortKeyMap[idea.effort]}`) }}
              </v-chip>
            </v-card-subtitle>
            <v-card-text>
              <div class="mb-4">
                <h3 class="text-h6 mb-2">{{ $t('ideas.description') }}</h3>
                <p>{{ idea.description }}</p>
              </div>
              <v-divider class="my-4"></v-divider>
              <div class="mb-4">
                <h3 class="text-h6 mb-2">{{ $t('ideas.benefits') }}</h3>
                <p>{{ idea.benefits }}</p>
              </div>
              <v-divider class="my-4"></v-divider>
              <div v-if="idea.tags.length" class="mb-4">
                <h3 class="text-h6 mb-2">{{ $t('ideas.tags') }}</h3>
                <v-chip v-for="tag in idea.tags" :key="tag" class="mr-1">
                  {{ tag }}
                </v-chip>
              </div>
            </v-card-text>
          </v-card>

          <v-card class="mt-4" v-if="timelineItems.length || canManageSteps">
            <v-card-title>{{ $t('ideas.activityTimeline') }}</v-card-title>
            <v-card-text>
              <v-timeline v-if="timelineItems.length" side="end" density="compact">
                <v-timeline-item
                  v-for="item in timelineItems"
                  :key="item.id"
                  size="small"
                  :dot-color="item.kind === 'step' ? 'success' : 'primary'"
                  :icon="item.kind === 'step' ? 'mdi-check-circle-outline' : undefined"
                >
                  <template v-slot:opposite>
                    <div class="text-caption">
                      {{ formatDateTime(item.timestamp) }}
                    </div>
                  </template>
                  <div v-if="item.kind === 'event'">
                    <!-- The connective between label and actor is locale-owned: the
                         old hardcoded " by " produced mixed-language Slovak rows
                         ("Schválené by Peter") once the labels got localized. -->
                    <strong>{{ eventLabel(item.event!) }}</strong>
                    {{ $t('events.actorConnective') }}
                    {{ item.event!.byUser?.name ?? $t('events.actorJira') }}
                    <p v-if="item.event!.note" class="text-caption mt-1">{{ item.event!.note }}</p>
                  </div>
                  <div v-else>
                    <strong>{{ $t('steps.title') }}</strong>
                    <p class="mt-1">{{ item.step!.text }}</p>
                  </div>
                </v-timeline-item>
              </v-timeline>

              <div v-if="canManageSteps" class="mt-4 d-flex align-center ga-2">
                <v-text-field
                  v-model="newStepText"
                  :placeholder="$t('steps.textPlaceholder')"
                  density="compact"
                  variant="outlined"
                  hide-details
                  @keyup.enter="addStep"
                ></v-text-field>
                <v-btn
                  color="primary"
                  variant="elevated"
                  @click="addStep"
                  :loading="addingStep"
                  :disabled="!newStepText.trim()"
                >
                  {{ $t('steps.addStep') }}
                </v-btn>
              </div>
            </v-card-text>
          </v-card>
        </v-col>

        <v-col cols="12" md="4">
          <v-card>
            <v-card-title>{{ $t('ideas.details') }}</v-card-title>
            <v-card-text>
              <v-list density="compact">
                <v-list-item>
                  <v-list-item-title>{{ $t('ideas.submittedBy') }}</v-list-item-title>
                  <v-list-item-subtitle>{{ idea.submitter.name }}</v-list-item-subtitle>
                </v-list-item>
                <v-list-item v-if="idea.department">
                  <v-list-item-title>{{ $t('ideas.department') }}</v-list-item-title>
                  <v-list-item-subtitle>{{ idea.department.name }}</v-list-item-subtitle>
                </v-list-item>
                <!-- The reviewer lands in `approver` for BOTH outcomes (the reject
                     endpoint writes the same field), so the label must follow the
                     status or a rejected idea reads "Approved By". -->
                <v-list-item v-if="idea.approver">
                  <v-list-item-title>{{ $t(idea.status === IdeaStatus.REJECTED ? 'ideas.rejectedByLabel' : 'ideas.approvedByLabel') }}</v-list-item-title>
                  <v-list-item-subtitle>{{ idea.approver.name }}</v-list-item-subtitle>
                </v-list-item>
                <v-list-item v-if="idea.assignee">
                  <v-list-item-title>{{ $t('ideas.assignedToLabel') }}</v-list-item-title>
                  <v-list-item-subtitle>{{ idea.assignee.name }}</v-list-item-subtitle>
                </v-list-item>
                <v-divider class="my-2"></v-divider>
                <v-list-item>
                  <v-list-item-title>{{ $t('ideas.submittedDate') }}</v-list-item-title>
                  <v-list-item-subtitle>{{ formatDate(idea.submittedAt) }}</v-list-item-subtitle>
                </v-list-item>
                <v-list-item v-if="idea.approvedAt">
                  <v-list-item-title>{{ $t('ideas.approvedDate') }}</v-list-item-title>
                  <v-list-item-subtitle>{{ formatDate(idea.approvedAt) }}</v-list-item-subtitle>
                </v-list-item>
                <v-list-item v-if="idea.startedAt">
                  <v-list-item-title>{{ $t('ideas.startedDate') }}</v-list-item-title>
                  <v-list-item-subtitle>{{ formatDate(idea.startedAt) }}</v-list-item-subtitle>
                </v-list-item>
                <v-list-item v-if="idea.completedAt">
                  <v-list-item-title>{{ $t('ideas.completedDate') }}</v-list-item-title>
                  <v-list-item-subtitle>{{ formatDate(idea.completedAt) }}</v-list-item-subtitle>
                </v-list-item>

                <!-- Submitter-only opt-in to lifecycle notifications, shown only when
                     a channel is enabled admin-side. Settings-style row at the bottom of the
                     card: label on the left, switch in the append slot on the right.
                     Optimistic flip with revert on failure (see onNotifyToggle). -->
                <template v-if="canToggleNotify">
                  <v-divider class="my-2"></v-divider>
                  <v-list-item>
                    <v-list-item-title>{{ $t('ideas.notifyToggle') }}</v-list-item-title>
                    <template v-slot:append>
                      <v-switch
                        :model-value="notifyOn"
                        @update:model-value="onNotifyToggle"
                        color="primary"
                        :aria-label="$t('ideas.notifyToggle')"
                        :loading="notifyUpdating"
                        :disabled="notifyUpdating"
                        density="compact"
                        hide-details
                        inset
                      ></v-switch>
                    </template>
                  </v-list-item>
                </template>
              </v-list>
              <!-- Review actions for a SUBMITTED idea — same dialogs and wording as
                   ReviewQueuePage, so a reviewer reading the full detail does not
                   have to walk back to the queue to act. -->
              <div v-if="canReview" class="d-flex ga-2 mt-4">
                <v-btn
                  color="success"
                  variant="elevated"
                  class="flex-grow-1"
                  prepend-icon="mdi-check"
                  @click="openReviewDialog('approve')"
                >
                  {{ $t('review.approve') }}
                </v-btn>
                <v-btn
                  color="error"
                  variant="outlined"
                  class="flex-grow-1"
                  prepend-icon="mdi-close"
                  @click="openReviewDialog('reject')"
                >
                  {{ $t('review.reject') }}
                </v-btn>
              </div>
              <v-btn
                v-if="canManageSteps"
                color="primary"
                variant="elevated"
                block
                class="mt-4"
                @click="completeDialog = true"
              >
                {{ $t('inProgress.markComplete') }}
              </v-btn>
              <!-- Force-done override: closes the idea from ANY state (mandatory
                   reason). Danger-colored tonal, unlike the primary lifecycle
                   actions — this is an escape hatch, not the normal path. -->
              <v-btn
                v-if="canMarkDone"
                color="error"
                variant="tonal"
                block
                class="mt-4"
                @click="markDoneDialog = true"
              >
                {{ $t('ideas.markDone') }}
              </v-btn>
            </v-card-text>
          </v-card>

          <!-- Jira execution block: the key/status/assignee/resolution mirror once
               dispatched, and/or the dispatch button itself for an eligible APPROVED
               idea (same gating + new-tab UX as ApprovedIdeasPage). After a
               Jira-side cancellation the kept key still renders, but labelled as a
               cancelled task (user decision 2026-08-20) — presenting it as the live
               "Jira issue" of a re-dispatchable idea would mislead. -->
          <v-card class="mt-4" v-if="idea.jiraIssueKey || canCreateJiraTask">
            <v-card-title>{{ $t('ideas.jiraTask') }}</v-card-title>
            <v-card-text>
              <v-list v-if="idea.jiraIssueKey" density="compact">
                <v-list-item>
                  <v-list-item-title>{{
                    $t(hasLiveJiraIssue ? 'ideas.jiraKey' : 'ideas.jiraCancelledKey')
                  }}</v-list-item-title>
                  <v-list-item-subtitle>
                    <a v-if="idea.jiraBrowseUrl" :href="idea.jiraBrowseUrl" target="_blank" rel="noopener">
                      {{ idea.jiraIssueKey }}
                    </a>
                    <span v-else>{{ idea.jiraIssueKey }}</span>
                  </v-list-item-subtitle>
                </v-list-item>
                <!-- Raw Jira status ONLY while the poller still monitors the issue —
                     a frozen status on an unmonitored idea reads as live data. The
                     caption below explains its absence. -->
                <v-list-item v-if="idea.jiraSyncActive && idea.jiraStatus">
                  <v-list-item-title>{{ $t('ideas.jiraStatus') }}</v-list-item-title>
                  <template v-slot:append>
                    <v-chip size="small" :color="jiraStatusColor" variant="tonal">{{ idea.jiraStatus }}</v-chip>
                  </template>
                </v-list-item>
                <v-list-item v-if="idea.jiraAssignee">
                  <v-list-item-title>{{ $t('ideas.jiraAssignee') }}</v-list-item-title>
                  <v-list-item-subtitle>{{ idea.jiraAssignee }}</v-list-item-subtitle>
                </v-list-item>
                <v-list-item v-if="idea.status === IdeaStatus.DONE && idea.jiraResolution">
                  <v-list-item-title>{{ $t('ideas.jiraResolution') }}</v-list-item-title>
                  <v-list-item-subtitle>{{ idea.jiraResolution }}</v-list-item-subtitle>
                </v-list-item>
              </v-list>
              <!-- Two distinct explanations: a watched issue updates within the
                   poll interval; a final state (completed or cancelled in Jira)
                   never will. -->
              <div v-if="hasLiveJiraIssue" class="text-caption text-medium-emphasis">
                {{ $t(idea.jiraSyncActive ? 'ideas.jiraSyncHint' : 'ideas.jiraFinalHint') }}
              </div>
              <v-btn
                v-if="canCreateJiraTask"
                color="success"
                variant="elevated"
                block
                :class="idea.jiraIssueKey ? 'mt-4' : ''"
                @click="openDispatchDialog"
                :loading="creatingJiraTask"
              >
                {{ $t('ideas.createJiraTask') }}
              </v-btn>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </div>

    <v-alert v-else type="error">
      {{ $t('ideas.ideaNotFound') }}
    </v-alert>

    <v-dialog v-model="completeDialog" max-width="500">
      <v-card>
        <v-card-title>{{ $t('inProgress.completeTitle') }}</v-card-title>
        <v-card-text>
          <p class="mb-4">{{ $t('inProgress.completeConfirm') }}</p>
          <v-textarea
            v-model="completeNote"
            :label="$t('inProgress.completionNotes')"
            variant="outlined"
            rows="3"
          ></v-textarea>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="completeDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="primary" @click="completeIdea" :loading="completing">
            {{ $t('inProgress.complete') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="markDoneDialog" max-width="500">
      <v-card>
        <v-card-title>{{ $t('ideas.markDoneTitle') }}</v-card-title>
        <v-card-text>
          <p class="mb-2">{{ $t('ideas.markDoneConfirm') }}</p>
          <!-- The app never writes to Jira: an actively watched task stays open
               there and merely stops being mirrored — the admin must know that
               BEFORE confirming. -->
          <v-alert
            v-if="idea?.jiraSyncActive"
            type="warning"
            variant="tonal"
            density="compact"
            class="mb-4"
          >
            {{ $t('ideas.markDoneJiraWarning') }}
          </v-alert>
          <v-textarea
            v-model="markDoneNote"
            :label="$t('ideas.markDoneReason')"
            :rules="[markDoneReasonRule]"
            counter="1000"
            maxlength="1000"
            variant="outlined"
            rows="3"
          ></v-textarea>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="markDoneDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn
            color="error"
            @click="markDoneIdea"
            :loading="markingDone"
            :disabled="!markDoneNoteValid"
          >
            {{ $t('ideas.markDone') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="approveDialog" max-width="500">
      <v-card>
        <v-card-title>{{ $t('review.approveTitle') }}</v-card-title>
        <v-card-text>
          <p class="mb-4">{{ $t('review.approveConfirm', { title: idea?.title }) }}</p>
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
          <v-btn color="success" @click="approveIdea" :loading="reviewProcessing">
            {{ $t('review.approve') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="rejectDialog" max-width="500">
      <v-card>
        <v-card-title>{{ $t('review.rejectTitle') }}</v-card-title>
        <v-card-text>
          <p class="mb-4">{{ $t('review.rejectConfirm', { title: idea?.title }) }}</p>
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
          <v-btn color="error" @click="rejectIdea" :loading="reviewProcessing">
            {{ $t('review.reject') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Dispatch dialog — twin of ApprovedIdeasPage's: required target project,
         preselected with the backend's resolution, list fetched fresh on every
         open. -->
    <v-dialog v-model="dispatchDialog" max-width="500">
      <v-card>
        <v-card-title>{{ $t('ideas.createJiraTask') }}</v-card-title>
        <v-card-text>
          <p class="mb-4">{{ $t('ideas.jiraProjectPrompt', { title: idea?.title }) }}</p>
          <v-combobox
            :model-value="dispatchProjectKey"
            @update:model-value="onDispatchProjectInput"
            @keydown.enter.prevent
            :label="$t('ideas.jiraProjectLabel')"
            variant="outlined"
            clearable
            :loading="dispatchProjectsLoading"
            :items="dispatchProjectItems"
            item-title="title"
            item-value="value"
            :return-object="false"
            :hint="dispatchProjectsHint"
            persistent-hint
            :error-messages="dispatchProjectError"
          ></v-combobox>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="dispatchDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn
            color="success"
            @click="confirmCreateJiraTask"
            :loading="creatingJiraTask"
            :disabled="!!dispatchProjectError || !dispatchProjectKey.trim()"
          >
            {{ $t('ideas.createJiraTask') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar" :color="snackbarColor" :timeout="8000">
      <div>{{ snackbarText }}</div>
      <a v-if="jiraLinkUrl" :href="jiraLinkUrl" target="_blank" rel="noopener" class="d-block mt-1 text-white">
        {{ jiraLinkUrl }}
      </a>
    </v-snackbar>
  </v-container>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '../stores/auth';
import { useOptionsStore } from '../stores/options';
import { ideasApi } from '../api/ideas';
import { IdeaStatus, Effort, statusColors, jiraCategoryColors, eventTypeKeyMap } from '../types';
import type { JiraProject } from '../types';
import { jiraSettingsApi } from '../api/jiraSettings';
import type { Idea, IdeaStep, IdeaEvent } from '../types';

interface TimelineItem {
  id: string;
  timestamp: string;
  kind: 'event' | 'step';
  event?: IdeaEvent;
  step?: IdeaStep;
}

const { locale, t, te } = useI18n();
const route = useRoute();
const authStore = useAuthStore();
const optionsStore = useOptionsStore();
const loading = ref(true);
const idea = ref<Idea | null>(null);

// Steps state
const newStepText = ref('');
const addingStep = ref(false);

// Complete dialog state
const completeDialog = ref(false);
const markDoneDialog = ref(false);
const markDoneNote = ref('');
const markingDone = ref(false);
const approveDialog = ref(false);
const rejectDialog = ref(false);
const reviewNote = ref('');
const reviewProcessing = ref(false);

// The backend rejects shorter reasons (markDoneSchema min 15) — mirror it here so
// the confirm button and the field rule agree with the server.
const MARK_DONE_REASON_MIN = 15;
const markDoneNoteValid = computed(() => markDoneNote.value.trim().length >= MARK_DONE_REASON_MIN);
const markDoneReasonRule = (v: string) =>
  v.trim().length >= MARK_DONE_REASON_MIN || t('ideas.markDoneReasonMinLength');
const completeNote = ref('');
const completing = ref(false);
const snackbar = ref(false);
const snackbarText = ref('');
const snackbarColor = ref('success');

// Jira dispatch state. `jiraLinkUrl` is set alongside the snackbar on a successful
// dispatch that DID carry a browse URL (the clickable popup-block fallback below the
// snackbar text); null otherwise, including every failure, so it never lingers.
const creatingJiraTask = ref(false);
const jiraLinkUrl = ref<string | null>(null);

// Notification opt-in state. `notifyOn` mirrors idea.notifyOnChange but is driven
// independently so a flip can be applied optimistically and reverted on failure.
// `notifyEnabled` tracks the options store reactively (like MainLayout) so a runtime
// channel toggle flips the notify switch's visibility without a manual re-snapshot.
const notifyEnabled = computed(() => optionsStore.notifyEnabled);
const notifyOn = ref(false);
const notifyUpdating = ref(false);

const canManageSteps = computed(() => {
  return idea.value?.status === IdeaStatus.IN_PROGRESS &&
    idea.value?.assigneeId === authStore.user?.id;
});

// The switch is shown only to the submitter, and only when a notification channel
// is enabled (same comparison style as canManageSteps).
const canToggleNotify = computed(() => {
  return notifyEnabled.value && idea.value?.submitterId === authStore.user?.id;
});

// Same gate as the review queue's list (which shows SUBMITTED ideas to reviewers);
// the backend enforces the role and the SUBMITTED-only transition anyway.
const canReview = computed(
  () => authStore.isPowerUser && idea.value?.status === IdeaStatus.SUBMITTED
);

// Force-done override: POWER_USER/ADMIN, APPROVED or IN_PROGRESS only (matching
// the backend guards) — a SUBMITTED idea goes through review first (the buttons
// above), a rejected one stays rejected. Deliberately NOT gated on the Jira flags
// — the override exists precisely for when the normal (Jira) path cannot finish
// the idea.
const canMarkDone = computed(
  () =>
    authStore.isPowerUser &&
    (idea.value?.status === IdeaStatus.APPROVED || idea.value?.status === IdeaStatus.IN_PROGRESS)
);

// Same gating as ApprovedIdeasPage's button: POWER_USER/ADMIN, the Jira channel
// effectively enabled, the idea APPROVED, and not already dispatched.
const canCreateJiraTask = computed(() => {
  return (
    authStore.isPowerUser &&
    optionsStore.jiraEnabled &&
    idea.value?.status === IdeaStatus.APPROVED &&
    !idea.value?.jiraSyncActive
  );
});

// Same gate as IdeaCard: a Jira-side cancellation turns sync off and nulls the raw
// status but keeps the key — that key renders under the "cancelled task" label
// instead of the live "Jira issue" one.
const hasLiveJiraIssue = computed(() =>
  Boolean(idea.value?.jiraIssueKey && (idea.value?.jiraSyncActive || idea.value?.jiraStatus))
);

// Colored by Jira's status CATEGORY; falls back to a neutral color when the
// category is not (yet) known.
const jiraStatusColor = computed(() =>
  idea.value?.jiraStatusCategory ? jiraCategoryColors[idea.value.jiraStatusCategory] : 'default'
);

const timelineItems = computed<TimelineItem[]>(() => {
  const items: TimelineItem[] = [];
  if (idea.value?.events) {
    for (const event of idea.value.events) {
      items.push({ id: `event-${event.id}`, timestamp: event.timestamp, kind: 'event', event });
    }
  }
  if (idea.value?.steps) {
    for (const step of idea.value.steps) {
      items.push({ id: `step-${step.id}`, timestamp: step.createdAt, kind: 'step', step });
    }
  }
  items.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  return items;
});

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

// Timeline label for one event: the mapped `events.<key>` translation when one
// exists, else the raw enum value — so an event type this build doesn't (yet) know
// about still renders something instead of a missing-key placeholder or a crash.
function eventLabel(event: IdeaEvent): string {
  const key = eventTypeKeyMap[event.type];
  const i18nKey = key ? `events.${key}` : null;
  if (i18nKey && te(i18nKey)) return t(i18nKey);
  return event.type;
}

async function loadIdea() {
  loading.value = true;
  try {
    const id = route.params.id as string;
    idea.value = await ideasApi.getOne(id);
    notifyOn.value = idea.value.notifyOnChange ?? false;
  } catch (error) {
    console.error('Error loading idea:', error);
  } finally {
    loading.value = false;
  }
}

// Flip the submitter's notification opt-in. Applied optimistically; on failure the
// switch reverts and the error surfaces through the page's snackbar. Only the
// notifyOnChange field is updated locally so the loaded timeline (events/steps,
// which the notify endpoint's response omits) is preserved.
async function onNotifyToggle(value: boolean | null) {
  if (!idea.value) return;
  // Race guard: ignore a toggle while a setNotify is still in flight. Overlapping
  // requests can settle out of order — the last RESPONSE wins locally but the last
  // REQUEST wins in the DB — so a fast double-flip could leave the two disagreeing.
  // The switch is also :disabled while updating; this is the belt-and-braces JS half.
  if (notifyUpdating.value) return;
  const enabled = value === true;
  const previous = notifyOn.value;
  notifyOn.value = enabled;
  notifyUpdating.value = true;
  try {
    await ideasApi.setNotify(idea.value.id, enabled);
    idea.value.notifyOnChange = enabled;
  } catch (error: any) {
    notifyOn.value = previous;
    jiraLinkUrl.value = null;
    snackbarText.value = error.response?.data?.error || 'Failed to update notifications';
    snackbarColor.value = 'error';
    snackbar.value = true;
  } finally {
    notifyUpdating.value = false;
  }
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const loc = locale.value === 'sk' ? 'sk-SK' : 'en-US';
  return date.toLocaleDateString(loc, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  const loc = locale.value === 'sk' ? 'sk-SK' : 'en-US';
  return date.toLocaleString(loc, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function completeIdea() {
  if (!idea.value) return;
  completing.value = true;
  try {
    await ideasApi.complete(idea.value.id, { note: completeNote.value });
    jiraLinkUrl.value = null;
    snackbarText.value = t('inProgress.completeSuccess');
    snackbarColor.value = 'success';
    snackbar.value = true;
    completeDialog.value = false;
    await loadIdea();
  } catch (error: any) {
    jiraLinkUrl.value = null;
    snackbarText.value = error.response?.data?.error || 'Failed to complete idea';
    snackbarColor.value = 'error';
    snackbar.value = true;
  } finally {
    completing.value = false;
  }
}

// Force-done override — mirrors completeIdea: refetch after success so the timeline
// shows the new COMPLETED entry (the PATCH response has no events/steps).
async function markDoneIdea() {
  if (!idea.value || !markDoneNoteValid.value) return;
  markingDone.value = true;
  try {
    await ideasApi.markDone(idea.value.id, markDoneNote.value.trim());
    jiraLinkUrl.value = null;
    snackbarText.value = t('ideas.markDoneSuccess');
    snackbarColor.value = 'success';
    snackbar.value = true;
    markDoneDialog.value = false;
    markDoneNote.value = '';
    await loadIdea();
  } catch {
    jiraLinkUrl.value = null;
    snackbarText.value = t('ideas.markDoneFailed');
    snackbarColor.value = 'error';
    snackbar.value = true;
  } finally {
    markingDone.value = false;
  }
}

function openReviewDialog(kind: 'approve' | 'reject') {
  reviewNote.value = '';
  if (kind === 'approve') approveDialog.value = true;
  else rejectDialog.value = true;
}

// Both mirror ReviewQueuePage's handlers (same endpoints, same wording), then
// refetch so the status chip, action buttons and timeline all update in place.
async function approveIdea() {
  if (!idea.value) return;
  reviewProcessing.value = true;
  try {
    await ideasApi.approve(idea.value.id, { note: reviewNote.value });
    jiraLinkUrl.value = null;
    snackbarText.value = t('review.approveSuccess');
    snackbarColor.value = 'success';
    snackbar.value = true;
    approveDialog.value = false;
    await loadIdea();
  } catch (error: any) {
    jiraLinkUrl.value = null;
    snackbarText.value = error.response?.data?.error || 'Failed to approve idea';
    snackbarColor.value = 'error';
    snackbar.value = true;
  } finally {
    reviewProcessing.value = false;
  }
}

async function rejectIdea() {
  if (!idea.value) return;
  reviewProcessing.value = true;
  try {
    await ideasApi.reject(idea.value.id, { note: reviewNote.value });
    jiraLinkUrl.value = null;
    snackbarText.value = t('review.rejectSuccess');
    snackbarColor.value = 'info';
    snackbar.value = true;
    rejectDialog.value = false;
    await loadIdea();
  } catch (error: any) {
    jiraLinkUrl.value = null;
    snackbarText.value = error.response?.data?.error || 'Failed to reject idea';
    snackbarColor.value = 'error';
    snackbar.value = true;
  } finally {
    reviewProcessing.value = false;
  }
}

// Dispatch the current idea to Jira (POWER_USER/ADMIN, gated by canCreateJiraTask).
// Mirrors ApprovedIdeasPage.createJiraTask: window.open kept synchronous in this
// promise chain, snackbar always also carries the URL as a clickable fallback when
// one exists, and the omitted-jiraBrowseUrl case is handled gracefully (no popup,
// no dead link — just the success message).
// --- dispatch dialog (optional explicit target project; twin of ApprovedIdeasPage) ---
const dispatchDialog = ref(false);
const dispatchProjectKey = ref('');
const dispatchProjects = ref<JiraProject[]>([]);
const dispatchProjectsLoading = ref(false);
const dispatchProjectsUnavailable = ref(false);

const dispatchProjectItems = computed(() =>
  dispatchProjects.value.map((p) => ({ title: `${p.key} — ${p.name}`, value: p.key }))
);
const dispatchProjectsHint = computed(() =>
  dispatchProjectsUnavailable.value ? t('ideas.jiraProjectUnavailable') : t('ideas.jiraProjectHint')
);
const dispatchProjectError = computed(() => {
  const v = dispatchProjectKey.value.trim();
  if (v === '') return '';
  return v.length <= 32 && /^[A-Za-z][A-Za-z0-9_]*$/.test(v) ? '' : t('ideas.jiraProjectInvalid');
});

function onDispatchProjectInput(v: string | null) {
  dispatchProjectKey.value = (v ?? '').toUpperCase();
}

function openDispatchDialog() {
  dispatchProjectKey.value = '';
  dispatchDialog.value = true;
  // Fresh on every open: the list follows the currently saved credentials.
  loadDispatchProjects();
  if (idea.value) loadDispatchTarget(idea.value.id);
}

// Preselect the RESOLVED target (department override ?? default) — best-effort,
// never clobbering what the user already typed.
async function loadDispatchTarget(ideaId: string) {
  try {
    const { projectKey } = await ideasApi.getJiraTarget(ideaId);
    // Same stale-response guard as ApprovedIdeasPage (deep-review fix).
    if (idea.value?.id !== ideaId) return;
    if (projectKey && dispatchProjectKey.value === '') {
      dispatchProjectKey.value = projectKey;
    }
  } catch {
    // No preselection then — the user picks or types the key.
  }
}

async function loadDispatchProjects() {
  dispatchProjectsLoading.value = true;
  try {
    const { projects, reason } = await jiraSettingsApi.getProjects();
    dispatchProjects.value = projects;
    dispatchProjectsUnavailable.value = reason !== undefined;
  } catch {
    dispatchProjects.value = [];
    dispatchProjectsUnavailable.value = true;
  } finally {
    dispatchProjectsLoading.value = false;
  }
}

async function confirmCreateJiraTask() {
  const chosenKey = dispatchProjectKey.value.trim();
  if (!idea.value || dispatchProjectError.value || !chosenKey) return;
  creatingJiraTask.value = true;
  try {
    const result = await ideasApi.createJiraTask(idea.value.id, chosenKey);
    dispatchDialog.value = false;
    if (result.jiraBrowseUrl) {
      window.open(result.jiraBrowseUrl, '_blank', 'noopener');
    }
    jiraLinkUrl.value = result.jiraBrowseUrl ?? null;
    snackbarText.value = t('ideas.createJiraTaskSuccess', { key: result.jiraIssueKey ?? '' });
    snackbarColor.value = 'success';
    snackbar.value = true;
    await loadIdea();
  } catch (error: any) {
    jiraLinkUrl.value = null;
    snackbarText.value = jiraTaskErrorText(error);
    snackbarColor.value = 'error';
    snackbar.value = true;
  } finally {
    creatingJiraTask.value = false;
  }
}

// Localized message for a failed dispatch — the raw backend `error` string is
// English and never shown. 409/400 get dispatch-specific wordings; a 502 carries the
// closed JiraFailureReason enum, resolved through the SAME te()-guarded reason
// catalog the settings test button uses. Keep in sync with ApprovedIdeasPage.vue's twin.
function jiraTaskErrorText(error: any): string {
  const status = error?.response?.status;
  if (status === 409) return t('ideas.createJiraTaskConflict');
  if (status === 400) return t('ideas.createJiraTaskBadState');
  const reason = error?.response?.data?.reason;
  if (status === 502 && typeof reason === 'string') {
    const key = `jiraSettings.testReason.${reason}`;
    if (te(key)) return t(key);
  }
  return t('ideas.createJiraTaskFailed');
}

async function addStep() {
  if (!idea.value || !newStepText.value.trim()) return;
  addingStep.value = true;
  try {
    const step = await ideasApi.addStep(idea.value.id, { text: newStepText.value.trim() });
    if (!idea.value.steps) idea.value.steps = [];
    idea.value.steps.push(step);
    newStepText.value = '';
  } catch (error) {
    console.error('Error adding step:', error);
  } finally {
    addingStep.value = false;
  }
}

onMounted(async () => {
  await loadIdea();
  // The channel-enabled flags are runtime-mutable, so refetch on mount.
  // `notifyEnabled` is a computed over the store, so it tracks this fetch (and any
  // later change) reactively. The store swallows failures and leaves the flags false,
  // so a failed read simply keeps the notify toggle hidden (same best-effort
  // semantics as before).
  await optionsStore.fetch();
});
</script>
