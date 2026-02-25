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
              <div class="text-overline mb-1">{{ $t('dashboard.submitted') }}</div>
              <div class="text-h4">{{ summary?.counts.submitted || 0 }}</div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" sm="6" md="4" lg="2">
          <v-card class="stat-card">
            <v-card-text>
              <div class="text-overline mb-1">{{ $t('dashboard.approved') }}</div>
              <div class="text-h4 text-success">{{ summary?.counts.approved || 0 }}</div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" sm="6" md="4" lg="2">
          <v-card class="stat-card">
            <v-card-text>
              <div class="text-overline mb-1">{{ $t('dashboard.inProgress') }}</div>
              <div class="text-h4 text-warning">{{ summary?.counts.inProgress || 0 }}</div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" sm="6" md="4" lg="2">
          <v-card class="stat-card">
            <v-card-text>
              <div class="text-overline mb-1">{{ $t('dashboard.done') }}</div>
              <div class="text-h4 text-primary">{{ summary?.counts.done || 0 }}</div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" sm="6" md="4" lg="2">
          <v-card class="stat-card">
            <v-card-text>
              <div class="text-overline mb-1">{{ $t('dashboard.rejected') }}</div>
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
        <v-col cols="12" md="6">
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
        </v-col>

        <v-col cols="12" md="6">
          <v-card>
            <v-card-title>{{ $t('dashboard.topContributors') }}</v-card-title>
            <v-card-text>
              <v-list>
                <v-list-item v-for="contributor in topContributors" :key="contributor.userId">
                  <template v-slot:prepend>
                    <v-avatar :image="`https://ui-avatars.com/api/?name=${contributor.userName}&background=1976D2&color=fff`"></v-avatar>
                  </template>
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

      <v-row>
        <v-col cols="12">
          <v-card>
            <v-card-title>{{ $t('dashboard.monthlyTrend') }}</v-card-title>
            <v-card-text>
              <div v-if="monthlyTrend.length" class="chart-container">
                <Line :data="chartData" :options="chartOptions" />
              </div>
              <div v-else class="text-center pa-4">
                <p>{{ $t('dashboard.noTrendData') }}</p>
              </div>
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
import type { DashboardSummary, MonthlyTrend, TopContributor } from '../types';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const { t } = useI18n();
const loading = ref(true);
const summary = ref<DashboardSummary | null>(null);
const monthlyTrend = ref<MonthlyTrend[]>([]);
const topContributors = ref<TopContributor[]>([]);

const chartData = computed(() => ({
  labels: monthlyTrend.value.map((item) => item.month),
  datasets: [
    {
      label: t('dashboard.completedIdeas'),
      data: monthlyTrend.value.map((item) => item.count),
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
    const [summaryData, trendData, contributorsData] = await Promise.all([
      reportsApi.getSummary(),
      reportsApi.getMonthlyTrend(),
      reportsApi.getTopContributors(5),
    ]);
    summary.value = summaryData;
    monthlyTrend.value = trendData;
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
