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
                    <strong>{{ item.event!.type }}</strong> by {{ item.event!.byUser.name }}
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
                <v-list-item v-if="idea.approver">
                  <v-list-item-title>{{ $t('ideas.approvedByLabel') }}</v-list-item-title>
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

    <v-snackbar v-model="snackbar" :color="snackbarColor">
      {{ snackbarText }}
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
import { IdeaStatus, Effort, statusColors } from '../types';
import type { Idea, IdeaStep, IdeaEvent } from '../types';

interface TimelineItem {
  id: string;
  timestamp: string;
  kind: 'event' | 'step';
  event?: IdeaEvent;
  step?: IdeaStep;
}

const { locale, t } = useI18n();
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
const completeNote = ref('');
const completing = ref(false);
const snackbar = ref(false);
const snackbarText = ref('');
const snackbarColor = ref('success');

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
    snackbarText.value = t('inProgress.completeSuccess');
    snackbarColor.value = 'success';
    snackbar.value = true;
    completeDialog.value = false;
    await loadIdea();
  } catch (error: any) {
    snackbarText.value = error.response?.data?.error || 'Failed to complete idea';
    snackbarColor.value = 'error';
    snackbar.value = true;
  } finally {
    completing.value = false;
  }
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
