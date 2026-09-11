<template>
  <v-container fluid class="page-container">
    <h1 class="text-h4 page-title">{{ $t('dashboard.title') }}</h1>

    <v-row v-if="loading">
      <v-col cols="12" class="text-center">
        <v-progress-circular indeterminate color="primary"></v-progress-circular>
      </v-col>
    </v-row>

    <div v-else>
      <v-row>
        <v-col cols="12" sm="6" md="4" lg="2">
          <v-card class="stat-card">
            <v-card-text>
              <div class="text-overline mb-1">{{ $t('status.submitted') }}</div>
              <div class="text-h4">{{ summary?.counts.submitted || 0 }}</div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" sm="6" md="4" lg="2">
          <v-card class="stat-card">
            <v-card-text>
              <div class="text-overline mb-1">{{ $t('status.approved') }}</div>
              <div class="text-h4 text-success">{{ summary?.counts.approved || 0 }}</div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" sm="6" md="4" lg="2">
          <v-card class="stat-card">
            <v-card-text>
              <div class="text-overline mb-1">{{ $t('status.inProgress') }}</div>
              <div class="text-h4 text-warning">{{ summary?.counts.inProgress || 0 }}</div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" sm="6" md="4" lg="2">
          <v-card class="stat-card">
            <v-card-text>
              <div class="text-overline mb-1">{{ $t('status.done') }}</div>
              <div class="text-h4 text-primary">{{ summary?.counts.done || 0 }}</div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" sm="6" md="4" lg="2">
          <v-card class="stat-card">
            <v-card-text>
              <div class="text-overline mb-1">{{ $t('status.rejected') }}</div>
              <div class="text-h4 text-error">{{ summary?.counts.rejected || 0 }}</div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" sm="6" md="4" lg="2">
          <v-card class="stat-card">
            <v-card-text>
              <div class="text-overline mb-1">{{ $t('dashboard.total') }}</div>
              <div class="text-h4">{{ summary?.counts.total || 0 }}</div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <v-row>
        <v-col cols="12" md="6" class="d-flex flex-column">
          <v-card>
            <v-card-title>{{ $t('dashboard.averageTimes') }}</v-card-title>
            <v-card-text>
              <v-list>
                <v-list-item>
                  <v-list-item-title>{{ $t('dashboard.submittedToApproved') }}</v-list-item-title>
                  <v-list-item-subtitle>{{ summary?.averageTimes.submittedToApprovedDays || 0 }} {{ $t('dashboard.days') }}</v-list-item-subtitle>
                </v-list-item>
                <v-list-item>
                  <v-list-item-title>{{ $t('dashboard.approvedToDone') }}</v-list-item-title>
                  <v-list-item-subtitle>{{ summary?.averageTimes.approvedToDoneDays || 0 }} {{ $t('dashboard.days') }}</v-list-item-subtitle>
                </v-list-item>
              </v-list>
            </v-card-text>
          </v-card>

          <v-card class="mt-6 flex-grow-1 d-flex flex-column">
            <v-card-title>{{ $t('dashboard.monthlyTrend') }}</v-card-title>
            <v-card-text class="flex-grow-1 d-flex flex-column">
              <div v-if="monthlyTrend.length" class="chart-container flex-grow-1">
                <Bar :data="chartData" :options="chartOptions" />
              </div>
              <div v-else class="text-center pa-4 my-auto">
                <p>{{ $t('dashboard.noTrendData') }}</p>
              </div>
            </v-card-text>
          </v-card>
        </v-col>

        <v-col cols="12" md="6" class="d-flex flex-column">
          <v-card class="flex-grow-1 d-flex flex-column">
            <v-card-title>{{ $t('dashboard.ideasByDepartment') }}</v-card-title>
            <v-card-text class="flex-grow-1 d-flex flex-column">
              <div v-if="byDepartment.length" class="chart-container flex-grow-1">
                <Bar :data="departmentChartData" :options="chartOptions" />
              </div>
              <div v-else class="text-center pa-4 my-auto">
                <p>{{ $t('dashboard.noDepartmentData') }}</p>
              </div>
            </v-card-text>
          </v-card>

          <v-card v-if="jiraStatuses.length" class="mt-6">
            <v-card-title>{{ $t('dashboard.jiraStatuses') }}</v-card-title>
            <v-card-text>
              <v-list>
                <v-list-item v-for="item in jiraStatuses" :key="item.status">
                  <v-list-item-title>{{ item.status }}</v-list-item-title>
                  <template v-slot:append>
                    <v-chip size="small" variant="tonal">{{ item.count }}</v-chip>
                  </template>
                </v-list-item>
              </v-list>
            </v-card-text>
          </v-card>

          <v-card v-if="authStore.isPowerUser" class="mt-6">
            <v-card-title>{{ $t('dashboard.topContributors') }}</v-card-title>
            <v-card-text>
              <v-list>
                <v-list-item v-for="contributor in topContributors" :key="contributor.userId">
                  <v-list-item-title>{{ contributor.userName }}</v-list-item-title>
                  <v-list-item-subtitle>{{ contributor.completedIdeas }} {{ $t('dashboard.ideasCompleted') }}</v-list-item-subtitle>
                </v-list-item>
                <v-list-item v-if="!topContributors.length">
                  <v-list-item-title>{{ $t('dashboard.noCompletedIdeas') }}</v-list-item-title>
                </v-list-item>
              </v-list>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </div>
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Bar } from 'vue-chartjs';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { reportsApi } from '../api/reports';
import { useAuthStore } from '../stores/auth';
import type { DashboardSummary, MonthlyTrend, TopContributor, DepartmentReport, JiraStatusReport } from '../types';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const { t } = useI18n();
const authStore = useAuthStore();
const loading = ref(true);
const summary = ref<DashboardSummary | null>(null);
const monthlyTrend = ref<MonthlyTrend[]>([]);
const topContributors = ref<TopContributor[]>([]);
const byDepartment = ref<DepartmentReport[]>([]);
const jiraStatuses = ref<JiraStatusReport[]>([]);

const chartData = computed(() => ({
  labels: monthlyTrend.value.map((item) => item.month),
  datasets: [
    {
      label: t('dashboard.completedIdeas'),
      data: monthlyTrend.value.map((item) => item.count),
      backgroundColor: 'rgba(18, 169, 154, 0.6)',
      borderColor: '#12A99A',
      borderWidth: 1,
      maxBarThickness: 64,
    },
  ],
}));

const departmentChartData = computed(() => ({
  labels: byDepartment.value.map((item) => item.name),
  datasets: [
    {
      label: t('dashboard.ideasByDepartment'),
      data: byDepartment.value.map((item) => item.count),
      backgroundColor: 'rgba(44, 50, 56, 0.6)',
      borderColor: '#2C3238',
      borderWidth: 1,
    },
  ],
}));

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: false,
    },
    title: {
      display: false,
    },
  },
  scales: {
    y: {
      beginAtZero: true,
      ticks: {
        stepSize: 1,
      },
    },
  },
};

async function loadDashboard() {
  loading.value = true;
  try {
    // The Jira breakdown is fetched OUTSIDE the all-or-nothing Promise.all: it is
    // the newest, least-critical widget, and a failure of its endpoint must hide
    // only its own card — not blank the summary/trend/department widgets with it
    // (deep-review fix). An empty list keeps the card hidden.
    const [summaryData, trendData, byDepartmentData] = await Promise.all([
      reportsApi.getSummary(),
      reportsApi.getMonthlyTrend(),
      reportsApi.getByDepartment(),
    ]);
    summary.value = summaryData;
    monthlyTrend.value = trendData;
    byDepartment.value = byDepartmentData;
    try {
      jiraStatuses.value = await reportsApi.getJiraStatuses();
    } catch (error) {
      console.error('Error loading Jira status breakdown:', error);
      jiraStatuses.value = [];
    }

    if (authStore.isPowerUser) {
      topContributors.value = await reportsApi.getTopContributors(5);
    }
  } catch (error) {
    console.error('Error loading dashboard:', error);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadDashboard();
});
</script>
