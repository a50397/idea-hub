<template>
  <v-container fluid class="page-container">
    <h1 class="text-h4 page-title">{{ $t('approved.title') }}</h1>
    <p class="text-subtitle-1 mb-4">{{ $t('approved.subtitle') }}</p>

    <v-row class="mb-4">
      <v-col cols="12" sm="4" md="3">
        <v-select
          v-model="departmentFilter"
          :items="departmentOptions"
          :label="$t('ideas.filterByDepartment')"
          variant="outlined"
          density="compact"
          @update:model-value="loadIdeas"
        ></v-select>
      </v-col>
    </v-row>

    <v-row v-if="loading">
      <v-col cols="12" class="text-center">
        <v-progress-circular indeterminate color="primary"></v-progress-circular>
      </v-col>
    </v-row>

    <div v-else>
      <v-alert v-if="truncated" type="info" variant="tonal" density="compact" class="mb-4">
        {{ $t('ideas.showingFirst', { shown: ideas.length, total }) }}
      </v-alert>
      <v-row v-if="ideas.length">
        <v-col v-for="idea in ideas" :key="idea.id" cols="12" md="6" lg="4">
          <IdeaCard :idea="idea" @view="viewIdea">
            <template #actions>
              <v-btn
                color="primary"
                variant="elevated"
                @click="showClaimDialog(idea)"
              >
                {{ $t('approved.claimStart') }}
              </v-btn>
            </template>
          </IdeaCard>
        </v-col>
      </v-row>
      <v-alert v-else type="info" variant="tonal">
        {{ $t('approved.noIdeas') }}
      </v-alert>
    </div>

    <!-- Claiming is irreversible (there is no unclaim), so it is confirmed. -->
    <v-dialog v-model="claimDialog" max-width="500">
      <v-card>
        <v-card-title>{{ $t('approved.claimTitle') }}</v-card-title>
        <v-card-text>
          {{ $t('approved.claimConfirm', { title: ideaToClaim?.title }) }}
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="claimDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="primary" @click="claimIdea" :loading="claiming">
            {{ $t('approved.claimAction') }}
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
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ideasApi } from '../api/ideas';
import { IdeaStatus, MAX_PAGE_LIMIT } from '../types';
import type { Idea } from '../types';
import IdeaCard from '../components/IdeaCard.vue';
import { useDepartmentsStore } from '../stores/departments';

const { t } = useI18n();
const router = useRouter();
const departmentsStore = useDepartmentsStore();
const loading = ref(true);
const ideas = ref<Idea[]>([]);
const total = ref(0);
const departmentFilter = ref<string | null>(null);
const claimDialog = ref(false);
const ideaToClaim = ref<Idea | null>(null);
const claiming = ref(false);
const snackbar = ref(false);
const snackbarText = ref('');
const snackbarColor = ref('success');

const departmentOptions = computed(() => [
  { title: t('ideas.allDepartments'), value: null },
  ...departmentsStore.sortedByOrder.map((d) => ({ title: d.name, value: d.id })),
]);

// The server caps a page at MAX_PAGE_LIMIT, so tell the user when there is more.
const truncated = computed(() => total.value > ideas.value.length);

async function loadIdeas() {
  loading.value = true;
  try {
    // Ideas are readable org-wide by every role, so no submitter scoping here.
    const filters: any = { status: IdeaStatus.APPROVED, limit: MAX_PAGE_LIMIT };
    if (departmentFilter.value) {
      filters.departmentId = departmentFilter.value;
    }
    const { data, pagination } = await ideasApi.getAll(filters);
    ideas.value = data;
    total.value = pagination.total;
  } catch (error) {
    console.error('Error loading ideas:', error);
  } finally {
    loading.value = false;
  }
}

function viewIdea(id: string) {
  router.push({ name: 'IdeaDetail', params: { id } });
}

function showClaimDialog(idea: Idea) {
  ideaToClaim.value = idea;
  claimDialog.value = true;
}

async function claimIdea() {
  if (!ideaToClaim.value) return;

  claiming.value = true;
  try {
    await ideasApi.claim(ideaToClaim.value.id);
    snackbarText.value = t('approved.claimSuccess');
    snackbarColor.value = 'success';
    snackbar.value = true;
    claimDialog.value = false;
    await loadIdeas();
  } catch (error: any) {
    snackbarText.value = error.response?.data?.error || 'Failed to claim idea';
    snackbarColor.value = 'error';
    snackbar.value = true;
    // The usual failure is a lost race (somebody else claimed it first), so the
    // list behind the dialog is stale. Close the dialog and refetch instead of
    // leaving the user re-confirming a card that can only 400 again.
    claimDialog.value = false;
    ideaToClaim.value = null;
    await loadIdeas();
  } finally {
    claiming.value = false;
  }
}

onMounted(() => {
  loadIdeas();
  departmentsStore.fetchAll();
});
</script>
