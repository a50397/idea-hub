<template>
  <v-container fluid class="page-container">
    <h1 class="text-h4 page-title">{{ $t('ideas.submitTitle') }}</h1>

    <v-row>
      <v-col cols="12" md="8">
        <v-card>
          <v-card-text>
            <v-form @submit.prevent="handleSubmit">
              <v-text-field
                v-model="formData.title"
                :label="$t('ideas.title') + ' *'"
                variant="outlined"
                :error-messages="errors.title"
                counter="120"
                :hint="$t('ideas.titleHint')"
                persistent-hint
                class="mb-4"
              ></v-text-field>

              <v-textarea
                v-model="formData.description"
                :label="$t('ideas.description') + ' *'"
                variant="outlined"
                :error-messages="errors.description"
                counter="3000"
                rows="5"
                :hint="$t('ideas.descriptionHint')"
                persistent-hint
                class="mb-4"
              ></v-textarea>

              <v-textarea
                v-model="formData.benefits"
                :label="$t('ideas.benefits') + ' *'"
                variant="outlined"
                :error-messages="errors.benefits"
                counter="3000"
                rows="4"
                :hint="$t('ideas.benefitsHint')"
                persistent-hint
                class="mb-4"
              ></v-textarea>

              <v-select
                v-model="formData.effort"
                :label="$t('ideas.effort') + ' *'"
                :items="effortOptions"
                variant="outlined"
                :error-messages="errors.effort"
                class="mb-4"
              ></v-select>

              <v-select
                v-model="formData.departmentId"
                :label="$t('ideas.department') + ' *'"
                :items="departmentsStore.sortedByOrder"
                item-title="name"
                item-value="id"
                variant="outlined"
                :error-messages="errors.department"
                class="mb-4"
              ></v-select>

              <v-combobox
                v-model="formData.tags"
                @keydown.enter.prevent
                :label="$t('ideas.tags')"
                variant="outlined"
                multiple
                chips
                closable-chips
                :hint="$t('ideas.tagsHint')"
                persistent-hint
              ></v-combobox>

              <!-- Opt-in to lifecycle notification emails. Only shown when an
                   admin has enabled outbound mail; defaults OFF (strict opt-in). -->
              <v-switch
                v-if="mailEnabled"
                :model-value="formData.notifyOnChange"
                @update:model-value="formData.notifyOnChange = $event === true"
                color="primary"
                :label="$t('ideas.notifyToggle')"
                :hint="$t('ideas.notifyToggleHint')"
                persistent-hint
                class="mt-4"
              ></v-switch>

              <v-alert v-if="submitError" type="error" class="mt-4">
                {{ submitError }}
              </v-alert>

              <v-alert v-if="submitSuccess" type="success" class="mt-4">
                {{ $t('ideas.submitSuccess') }}
              </v-alert>

              <div class="mt-4">
                <v-btn
                  type="submit"
                  color="primary"
                  size="large"
                  :loading="submitting"
                  prepend-icon="mdi-send"
                >
                  {{ $t('ideas.submitIdea') }}
                </v-btn>
                <v-btn
                  class="ml-2"
                  @click="resetForm"
                  variant="outlined"
                >
                  {{ $t('common.reset') }}
                </v-btn>
              </div>
            </v-form>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" md="4">
        <v-card>
          <v-card-title>{{ $t('guidelines.title') }}</v-card-title>
          <v-card-text>
            <v-list density="compact">
              <v-list-item>
                <template v-slot:prepend>
                  <v-icon>mdi-check-circle</v-icon>
                </template>
                <v-list-item-title>{{ $t('guidelines.specific') }}</v-list-item-title>
              </v-list-item>
              <v-list-item>
                <template v-slot:prepend>
                  <v-icon>mdi-check-circle</v-icon>
                </template>
                <v-list-item-title>{{ $t('guidelines.problem') }}</v-list-item-title>
              </v-list-item>
              <v-list-item>
                <template v-slot:prepend>
                  <v-icon>mdi-check-circle</v-icon>
                </template>
                <v-list-item-title>{{ $t('guidelines.benefits') }}</v-list-item-title>
              </v-list-item>
              <v-list-item>
                <template v-slot:prepend>
                  <v-icon>mdi-check-circle</v-icon>
                </template>
                <v-list-item-title>{{ $t('guidelines.effort') }}</v-list-item-title>
              </v-list-item>
              <v-list-item>
                <template v-slot:prepend>
                  <v-icon>mdi-check-circle</v-icon>
                </template>
                <v-list-item-title>{{ $t('guidelines.tags') }}</v-list-item-title>
              </v-list-item>
            </v-list>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { ideasApi } from '../api/ideas';
import { useDepartmentsStore } from '../stores/departments';
import { useOptionsStore } from '../stores/options';
import { Effort } from '../types';
import type { CreateIdeaInput } from '../types';

const { t } = useI18n();
const departmentsStore = useDepartmentsStore();
const optionsStore = useOptionsStore();

const effortOptions = computed(() => [
  { title: t('effort.lessThanOneDay'), value: Effort.LESS_THAN_ONE_DAY },
  { title: t('effort.oneToThreeDays'), value: Effort.ONE_TO_THREE_DAYS },
  { title: t('effort.moreThanThreeDays'), value: Effort.MORE_THAN_THREE_DAYS },
]);

const formData = reactive({
  title: '',
  description: '',
  benefits: '',
  effort: null as Effort | null,
  departmentId: null as string | null,
  tags: [] as string[],
  notifyOnChange: false,
});

// Whether outbound mail is enabled admin-side; drives the notify toggle's
// visibility and whether the opt-in is carried in the create payload. Tracks the
// options store reactively (like MainLayout), so a runtime mail toggle updates it.
// An options-fetch failure is treated as disabled (the store resets the flag to
// false; no error surfaced).
const mailEnabled = computed(() => optionsStore.mailEnabled);

const errors = reactive({
  title: [] as string[],
  description: [] as string[],
  benefits: [] as string[],
  effort: [] as string[],
  department: [] as string[],
});

const submitting = ref(false);
const submitError = ref('');
const submitSuccess = ref(false);

function validateForm(): boolean {
  errors.title = [];
  errors.description = [];
  errors.benefits = [];
  errors.effort = [];
  errors.department = [];

  if (!formData.title || formData.title.length < 5) {
    errors.title.push(t('validation.titleMinLength'));
  }
  if (formData.title.length > 120) {
    errors.title.push(t('validation.titleMaxLength'));
  }

  if (!formData.description || formData.description.length < 10) {
    errors.description.push(t('validation.descriptionMinLength'));
  }
  if (formData.description.length > 3000) {
    errors.description.push(t('validation.descriptionMaxLength'));
  }

  if (!formData.benefits || formData.benefits.length < 10) {
    errors.benefits.push(t('validation.benefitsMinLength'));
  }
  if (formData.benefits.length > 3000) {
    errors.benefits.push(t('validation.benefitsMaxLength'));
  }

  if (!formData.effort) {
    errors.effort.push(t('validation.effortRequired'));
  }

  if (!formData.departmentId) {
    errors.department.push(t('validation.departmentRequired'));
  }

  return (
    !errors.title.length &&
    !errors.description.length &&
    !errors.benefits.length &&
    !errors.effort.length &&
    !errors.department.length
  );
}

async function handleSubmit() {
  submitError.value = '';
  submitSuccess.value = false;

  if (!validateForm()) {
    return;
  }

  submitting.value = true;
  try {
    const payload: CreateIdeaInput = {
      title: formData.title,
      description: formData.description,
      benefits: formData.benefits,
      effort: formData.effort!,
      departmentId: formData.departmentId!,
      tags: formData.tags,
    };
    // Only carry the opt-in when the toggle is actually shown (mail enabled);
    // otherwise the field is omitted entirely and the backend defaults it to false.
    if (mailEnabled.value) {
      payload.notifyOnChange = formData.notifyOnChange;
    }
    await ideasApi.create(payload);
    submitSuccess.value = true;
    resetForm();
    setTimeout(() => {
      submitSuccess.value = false;
    }, 5000);
  } catch (error: any) {
    submitError.value = error.response?.data?.error || 'Failed to submit idea';
  } finally {
    submitting.value = false;
  }
}

function resetForm() {
  formData.title = '';
  formData.description = '';
  formData.benefits = '';
  formData.effort = null;
  formData.tags = [];
  formData.notifyOnChange = false;
  errors.title = [];
  errors.description = [];
  errors.benefits = [];
  errors.effort = [];
  errors.department = [];
  // Re-preselect the default department so the field is never left empty.
  preselectDefaultDepartment();
}

// The department is required on submit and defaults to the first-by-order one.
function preselectDefaultDepartment() {
  formData.departmentId = departmentsStore.defaultDepartment?.id ?? null;
}

onMounted(async () => {
  await departmentsStore.fetchAll();
  preselectDefaultDepartment();
  // The mail-enabled flag is runtime-mutable, so refetch on mount. `mailEnabled` is
  // a computed over the store, so it tracks this fetch reactively. The store swallows
  // failures and leaves the flag false, so a failed read simply keeps the notify
  // toggle hidden (same best-effort semantics as before).
  await optionsStore.fetch();
});
</script>
