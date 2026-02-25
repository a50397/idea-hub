<template>
  <v-container fluid class="page-container">
    <h1 class="text-h4 page-title">{{ $t('reports.title') }}</h1>

    <v-card class="mb-4">
      <v-card-title>{{ $t('reports.filters') }}</v-card-title>
      <v-card-text>
        <v-row>
          <v-col cols="12" md="3">
            <v-select
              v-model="filters.status"
              :label="$t('reports.status')"
              :items="statusOptions"
              clearable
              variant="outlined"
              density="compact"
            ></v-select>
          </v-col>
          <v-col cols="12" md="3">
            <v-text-field
              v-model="filters.startDate"
              :label="$t('reports.startDate')"
              type="date"
              variant="outlined"
              density="compact"
            ></v-text-field>
          </v-col>
          <v-col cols="12" md="3">
            <v-text-field
              v-model="filters.endDate"
              :label="$t('reports.endDate')"
              type="date"
              variant="outlined"
              density="compact"
            ></v-text-field>
          </v-col>
          <v-col cols="12" md="3" class="d-flex align-center">
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
            </v-data-table>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

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
import { IdeaStatus, Effort, statusColors } from '../types';
import type { Idea } from '../types';

const { t, locale } = useI18n();
const router = useRouter();
const loading = ref(false);
const exporting = ref(false);
const ideas = ref<Idea[]>([]);
const snackbar = ref(false);
const snackbarText = ref('');
const snackbarColor = ref('success');

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

const headers = computed(() => [
  { title: t('reports.headerTitle'), key: 'title', sortable: true },
  { title: t('reports.headerStatus'), key: 'status', sortable: true },
  { title: t('reports.headerEffort'), key: 'effort', sortable: true },
  { title: t('reports.headerSubmitter'), key: 'submitter', sortable: true },
  { title: t('reports.headerAssignee'), key: 'assignee', sortable: true },
  { title: t('reports.headerSubmitted'), key: 'submittedAt', sortable: true },
  { title: t('reports.headerDuration'), key: 'duration', sortable: true },
]);

async function applyFilters() {
  loading.value = true;
  try {
    const filterParams: any = {};
    if (filters.status) filterParams.status = filters.status;
    if (filters.startDate) filterParams.startDate = filters.startDate;
    if (filters.endDate) filterParams.endDate = filters.endDate;

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

onMounted(() => {
  applyFilters();
});
</script>
