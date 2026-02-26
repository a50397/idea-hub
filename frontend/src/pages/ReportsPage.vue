<template>
  <v-container fluid class="page-container">
    <h1 class="text-h4 page-title">{{ $t('reports.title') }}</h1>

    <v-card class="mb-4">
      <v-card-title>{{ $t('reports.filters') }}</v-card-title>
      <v-card-text>
        <v-row align="center" no-gutters class="ga-4">
          <v-col cols="12" sm="auto" style="min-width: 200px; max-width: 250px;">
            <v-select
              v-model="filters.status"
              :label="$t('reports.status')"
              :items="statusOptions"
              clearable
              variant="outlined"
              density="compact"
              hide-details
            ></v-select>
          </v-col>
          <v-col cols="12" sm="auto" style="min-width: 180px; max-width: 220px;">
            <v-text-field
              v-model="filters.startDate"
              :label="$t('reports.startDate')"
              type="date"
              variant="outlined"
              density="compact"
              hide-details
            ></v-text-field>
          </v-col>
          <v-col cols="12" sm="auto" style="min-width: 180px; max-width: 220px;">
            <v-text-field
              v-model="filters.endDate"
              :label="$t('reports.endDate')"
              type="date"
              variant="outlined"
              density="compact"
              hide-details
            ></v-text-field>
          </v-col>
          <v-col cols="12" sm="auto" class="d-flex align-center">
            <v-btn @click="applyFilters" color="primary" class="mr-2">
              {{ $t('common.apply') }}
            </v-btn>
            <v-btn @click="resetFilters" variant="outlined">
              {{ $t('common.reset') }}
            </v-btn>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <v-row>
      <v-col cols="12">
        <v-card>
          <v-card-title class="d-flex align-center">
            <span class="flex-grow-1">{{ $t('reports.filteredResults') }} ({{ ideas.length }})</span>
            <v-btn
              @click="exportCSV"
              color="success"
              prepend-icon="mdi-download"
              :loading="exporting"
            >
              {{ $t('reports.exportCSV') }}
            </v-btn>
          </v-card-title>
          <v-card-text>
            <v-data-table
              :headers="headers"
              :items="ideas"
              :loading="loading"
              item-value="id"
            >
              <template v-slot:item.title="{ item }">
                <v-btn
                  variant="text"
                  @click="viewIdea(item.id)"
                  class="text-none"
                >
                  {{ item.title }}
                </v-btn>
              </template>
              <template v-slot:item.status="{ item }">
                <v-chip :color="statusColors[item.status]" size="small">
                  {{ $t(`status.${statusKeyMap[item.status]}`) }}
                </v-chip>
              </template>
              <template v-slot:item.effort="{ item }">
                <v-chip size="small" variant="outlined">
                  {{ $t(`effort.${effortKeyMap[item.effort]}`) }}
                </v-chip>
              </template>
              <template v-slot:item.submitter="{ item }">
                {{ item.submitter.name }}
              </template>
              <template v-slot:item.assignee="{ item }">
                {{ item.assignee?.name || '-' }}
              </template>
              <template v-slot:item.submittedAt="{ item }">
                {{ formatDate(item.submittedAt) }}
              </template>
              <template v-slot:item.duration="{ item }">
                {{ calculateDuration(item) }}
              </template>
              <template v-slot:item.actions="{ item }" v-if="authStore.isAdmin">
                <v-btn
                  icon
                  size="small"
                  variant="text"
                  color="error"
                  @click="showDeleteDialog(item)"
                >
                  <v-icon size="small">mdi-delete</v-icon>
                </v-btn>
              </template>
            </v-data-table>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-dialog v-model="deleteDialog" max-width="500">
      <v-card>
        <v-card-title>{{ $t('reports.deleteIdea') }}</v-card-title>
        <v-card-text>
          {{ $t('reports.deleteConfirm', { title: ideaToDelete?.title }) }}
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="deleteDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="error" @click="deleteIdea" :loading="deleting">
            {{ $t('common.delete') }}
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
import { ref, reactive, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { reportsApi } from '../api/reports';
import { ideasApi } from '../api/ideas';
import { IdeaStatus, Effort, statusColors } from '../types';
import type { Idea } from '../types';
import { useAuthStore } from '../stores/auth';

const { t, locale } = useI18n();
const router = useRouter();
const authStore = useAuthStore();
const loading = ref(false);
const exporting = ref(false);
const ideas = ref<Idea[]>([]);
const snackbar = ref(false);
const snackbarText = ref('');
const snackbarColor = ref('success');
const deleteDialog = ref(false);
const ideaToDelete = ref<Idea | null>(null);
const deleting = ref(false);

const filters = reactive({
  status: null as IdeaStatus | null,
  startDate: '',
  endDate: '',
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

const statusOptions = computed(() =>
  Object.values(IdeaStatus).map((status) => ({
    title: t(`status.${statusKeyMap[status]}`),
    value: status,
  }))
);

const headers = computed(() => {
  const cols = [
    { title: t('reports.headerTitle'), key: 'title', sortable: true },
    { title: t('reports.headerStatus'), key: 'status', sortable: true },
    { title: t('reports.headerEffort'), key: 'effort', sortable: true },
    { title: t('reports.headerSubmitter'), key: 'submitter', sortable: true },
    { title: t('reports.headerAssignee'), key: 'assignee', sortable: true },
    { title: t('reports.headerSubmitted'), key: 'submittedAt', sortable: true },
    { title: t('reports.headerDuration'), key: 'duration', sortable: true },
  ];
  if (authStore.isAdmin) {
    cols.push({ title: t('reports.headerActions'), key: 'actions', sortable: false });
  }
  return cols;
});

async function applyFilters() {
  loading.value = true;
  try {
    const filterParams: any = {};
    if (filters.status) filterParams.status = filters.status;
    if (filters.startDate) filterParams.startDate = filters.startDate;
    if (filters.endDate) filterParams.endDate = filters.endDate;

    if (!authStore.isPowerUser && !authStore.isAdmin && authStore.user?.id) {
      filterParams.submitterId = authStore.user.id;
    }

    ideas.value = await reportsApi.getFiltered(filterParams);
  } catch (error) {
    console.error('Error applying filters:', error);
    snackbarText.value = t('reports.filterFailed');
    snackbarColor.value = 'error';
    snackbar.value = true;
  } finally {
    loading.value = false;
  }
}

function resetFilters() {
  filters.status = null;
  filters.startDate = '';
  filters.endDate = '';
  applyFilters();
}

async function exportCSV() {
  exporting.value = true;
  try {
    const filterParams: any = {};
    if (filters.status) filterParams.status = filters.status;
    if (filters.startDate) filterParams.startDate = filters.startDate;
    if (filters.endDate) filterParams.endDate = filters.endDate;

    if (!authStore.isPowerUser && !authStore.isAdmin && authStore.user?.id) {
      filterParams.submitterId = authStore.user.id;
    }

    const blob = await reportsApi.exportCSV(filterParams);
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ideas-report-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    window.URL.revokeObjectURL(url);

    snackbarText.value = t('reports.exportSuccess');
    snackbarColor.value = 'success';
    snackbar.value = true;
  } catch (error) {
    console.error('Error exporting CSV:', error);
    snackbarText.value = t('reports.exportFailed');
    snackbarColor.value = 'error';
    snackbar.value = true;
  } finally {
    exporting.value = false;
  }
}

function viewIdea(id: string) {
  router.push({ name: 'IdeaDetail', params: { id } });
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const loc = locale.value === 'sk' ? 'sk-SK' : 'en-US';
  return date.toLocaleDateString(loc, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function calculateDuration(idea: Idea): string {
  if (!idea.completedAt || !idea.submittedAt) return '-';
  const start = new Date(idea.submittedAt);
  const end = new Date(idea.completedAt);
  const days = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  return `${days}`;
}

function showDeleteDialog(idea: Idea) {
  ideaToDelete.value = idea;
  deleteDialog.value = true;
}

async function deleteIdea() {
  if (!ideaToDelete.value) return;
  deleting.value = true;
  try {
    await ideasApi.delete(ideaToDelete.value.id);
    snackbarText.value = t('reports.deleteSuccess');
    snackbarColor.value = 'success';
    snackbar.value = true;
    deleteDialog.value = false;
    await applyFilters();
  } catch (error: any) {
    snackbarText.value = error.response?.data?.error || t('reports.deleteFailed');
    snackbarColor.value = 'error';
    snackbar.value = true;
  } finally {
    deleting.value = false;
  }
}

onMounted(() => {
  applyFilters();
});
</script>
