<template>
  <v-container fluid class="page-container">
    <h1 class="text-h4 page-title">{{ t('dashboard.title') }}</h1>

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
              <div class="text-overline mb-1">{{ t('dashboard.submitted') }}</div>
              <div class="text-h4">{{ summary?.counts.submitted || 0 }}</div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" sm="6" md="4" lg="2">
          <v-card class="stat-card">
            <v-card-text>
              <div class="text-overline mb-1">{{ t('dashboard.approved') }}</div>
              <div class="text-h4 text-success">{{ summary?.counts.approved || 0 }}</div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" sm="6" md="4" lg="2">
          <v-card class="stat-card">
            <v-card-text>
              <div class="text-overline mb-1">{{ t('dashboard.inProgress') }}</div>
              <div class="text-h4 text-warning">{{ summary?.counts.inProgress || 0 }}</div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" sm="6" md="4" lg="2">
          <v-card class="stat-card">
            <v-card-text>
              <div class="text-overline mb-1">{{ t('dashboard.done') }}</div>
              <div class="text-h4 text-primary">{{ summary?.counts.done || 0 }}</div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" sm="6" md="4" lg="2">
          <v-card class="stat-card">
            <v-card-text>
              <div class="text-overline mb-1">{{ t('dashboard.rejected') }}</div>
              <div class="text-h4 text-error">{{ summary?.counts.rejected || 0 }}</div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" sm="6" md="4" lg="2">
          <v-card class="stat-card">
            <v-card-text>
              <div class="text-overline mb-1">{{ t('dashboard.total') }}</div>
              <div class="text-h4">{{ summary?.counts.total || 0 }}</div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <v-row>
        <v-col cols="12" md="6">
          <v-card>
            <v-card-title>{{ t('dashboard.averageTimes') }}</v-card-title>
            <v-card-text>
              <v-list>
                <v-list-item>
                  <v-list-item-title>{{ t('dashboard.submittedToApproved') }}</v-list-item-title>
                  <v-list-item-subtitle>{{ summary?.averageTimes.submittedToApprovedDays || 0 }} {{ t('common.days') }}</v-list-item-subtitle>
                </v-list-item>
                <v-list-item>
                  <v-list-item-title>{{ t('dashboard.approvedToDone') }}</v-list-item-title>
                  <v-list-item-subtitle>{{ summary?.averageTimes.approvedToDoneDays || 0 }} {{ t('common.days') }}</v-list-item-subtitle>
                </v-list-item>
              </v-list>
            </v-card-text>
          </v-card>
        </v-col>

        <v-col cols="12" md="6">
          <v-card>
            <v-card-title>{{ t('dashboard.topContributors') }}</v-card-title>
            <v-card-text>
              <v-list>
                <v-list-item v-for="contributor in topContributors" :key="contributor.userId">
                  <template v-slot:prepend>
                    <v-avatar :image="`https://ui-avatars.com/api/?name=${contributor.userName}&background=1976D2&color=fff`"></v-avatar>
                  </template>
                  <v-list-item-title>{{ contributor.userName }}</v-list-item-title>
                  <v-list-item-subtitle>{{ contributor.completedIdeas }} {{ t('dashboard.ideasCompleted') }}</v-list-item-subtitle>
                </v-list-item>
                <v-list-item v-if="!topContributors.length">
                  <v-list-item-title>{{ t('dashboard.noCompletedIdeas') }}</v-list-item-title>
                </v-list-item>
              </v-list>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <v-row>
        <v-col cols="12">
          <v-card>
            <v-card-title class="d-flex align-center">
              <span class="flex-grow-1">{{ t('dashboard.trendTitle') }}</span>
              <v-btn-toggle v-model="trendView" mandatory variant="outlined" divided>
                <v-btn value="monthly">
                  {{ t('dashboard.viewMonthly') }}
                </v-btn>
                <v-btn value="weekly">
                  {{ t('dashboard.viewWeekly') }}
                </v-btn>
              </v-btn-toggle>
            </v-card-title>
            <v-card-text>
              <div v-if="currentTrendData.length" class="chart-container">
                <Line :data="chartData" :options="chartOptions" />
              </div>
              <div v-else class="text-center pa-4">
                <p>{{ t('dashboard.noData') }}</p>
              </div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </div>
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Line } from 'vue-chartjs';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { reportsApi } from '../api/reports';
import type { DashboardSummary, MonthlyTrend, WeeklyTrend, TopContributor } from '../types';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const { t } = useI18n();
const loading = ref(true);
const summary = ref<DashboardSummary | null>(null);
const monthlyTrend = ref<MonthlyTrend[]>([]);
const weeklyTrend = ref<WeeklyTrend[]>([]);
const topContributors = ref<TopContributor[]>([]);
const trendView = ref<'monthly' | 'weekly'>('monthly');

const currentTrendData = computed(() => {
  if (trendView.value === 'weekly') {
    return weeklyTrend.value;
  }
  return monthlyTrend.value;
});

const chartData = computed(() => ({
  labels: currentTrendData.value.map((item) =>
    trendView.value === 'weekly' ? (item as WeeklyTrend).week : (item as MonthlyTrend).month
  ),
  datasets: [
    {
      label: t('dashboard.submitted'),
      data: currentTrendData.value.map((item) => item.submitted),
      borderColor: '#2196F3',
      backgroundColor: 'rgba(33, 150, 243, 0.1)',
      tension: 0.3,
    },
    {
      label: t('dashboard.approved'),
      data: currentTrendData.value.map((item) => item.approved),
      borderColor: '#4CAF50',
      backgroundColor: 'rgba(76, 175, 80, 0.1)',
      tension: 0.3,
    },
    {
      label: t('dashboard.rejected'),
      data: currentTrendData.value.map((item) => item.rejected),
      borderColor: '#F44336',
      backgroundColor: 'rgba(244, 67, 54, 0.1)',
      tension: 0.3,
    },
    {
      label: t('dashboard.done'),
      data: currentTrendData.value.map((item) => item.completed),
      borderColor: '#1976D2',
      backgroundColor: 'rgba(25, 118, 210, 0.1)',
      tension: 0.3,
    },
  ],
}));

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'top' as const,
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
    const [summaryData, monthlyData, weeklyData, contributorsData] = await Promise.all([
      reportsApi.getSummary(),
      reportsApi.getMonthlyTrend(),
      reportsApi.getWeeklyTrend(),
      reportsApi.getTopContributors(5),
    ]);
    summary.value = summaryData;
    monthlyTrend.value = monthlyData;
    weeklyTrend.value = weeklyData;
    topContributors.value = contributorsData;
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
