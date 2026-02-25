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
              ></v-textarea>

              <v-select
                v-model="formData.effort"
                :label="$t('ideas.effort') + ' *'"
                :items="effortOptions"
                variant="outlined"
                :error-messages="errors.effort"
              ></v-select>

              <v-combobox
                v-model="formData.tags"
                :label="$t('ideas.tags')"
                variant="outlined"
                multiple
                chips
                closable-chips
                :hint="$t('ideas.tagsHint')"
                persistent-hint
              ></v-combobox>

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
import { ref, reactive, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { ideasApi } from '../api/ideas';
import { Effort } from '../types';

const { t } = useI18n();

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
  tags: [] as string[],
});

const errors = reactive({
  title: [] as string[],
  description: [] as string[],
  benefits: [] as string[],
  effort: [] as string[],
});

const submitting = ref(false);
const submitError = ref('');
const submitSuccess = ref(false);

function validateForm(): boolean {
  errors.title = [];
  errors.description = [];
  errors.benefits = [];
  errors.effort = [];

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

  return !errors.title.length && !errors.description.length && !errors.benefits.length && !errors.effort.length;
}

async function handleSubmit() {
  submitError.value = '';
  submitSuccess.value = false;

  if (!validateForm()) {
    return;
  }

  submitting.value = true;
  try {
    await ideasApi.create({
      title: formData.title,
      description: formData.description,
      benefits: formData.benefits,
      effort: formData.effort!,
      tags: formData.tags,
    });
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
  errors.title = [];
  errors.description = [];
  errors.benefits = [];
  errors.effort = [];
}
</script>
