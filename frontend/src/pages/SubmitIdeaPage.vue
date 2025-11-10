<template>
  <v-container fluid class="page-container">
    <h1 class="text-h4 page-title">Submit New Idea</h1>

    <v-row>
      <v-col cols="12" md="8">
        <v-card>
          <v-card-text>
            <v-form @submit.prevent="handleSubmit">
              <v-text-field
                v-model="formData.title"
                label="Title *"
                variant="outlined"
                :error-messages="errors.title"
                counter="120"
                hint="5-120 characters"
                persistent-hint
              ></v-text-field>

              <v-textarea
                v-model="formData.description"
                label="Description *"
                variant="outlined"
                :error-messages="errors.description"
                counter="3000"
                rows="5"
                hint="Describe your idea in detail (10-3000 characters)"
                persistent-hint
              ></v-textarea>

              <v-textarea
                v-model="formData.benefits"
                label="Benefits *"
                variant="outlined"
                :error-messages="errors.benefits"
                counter="3000"
                rows="4"
                hint="What are the expected benefits? (10-3000 characters)"
                persistent-hint
              ></v-textarea>

              <v-select
                v-model="formData.effort"
                label="Estimated Effort *"
                :items="effortOptions"
                variant="outlined"
                :error-messages="errors.effort"
              ></v-select>

              <v-combobox
                v-model="formData.tags"
                label="Tags (optional)"
                variant="outlined"
                multiple
                chips
                closable-chips
                hint="Press Enter to add a tag"
                persistent-hint
              ></v-combobox>

              <v-alert v-if="submitError" type="error" class="mt-4">
                {{ submitError }}
              </v-alert>

              <v-alert v-if="submitSuccess" type="success" class="mt-4">
                Idea submitted successfully!
              </v-alert>

              <div class="mt-4">
                <v-btn
                  type="submit"
                  color="primary"
                  size="large"
                  :loading="submitting"
                  prepend-icon="mdi-send"
                >
                  Submit Idea
                </v-btn>
                <v-btn
                  class="ml-2"
                  @click="resetForm"
                  variant="outlined"
                >
                  Reset
                </v-btn>
              </div>
            </v-form>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" md="4">
        <v-card>
          <v-card-title>Submission Guidelines</v-card-title>
          <v-card-text>
            <v-list density="compact">
              <v-list-item>
                <template v-slot:prepend>
                  <v-icon>mdi-check-circle</v-icon>
                </template>
                <v-list-item-title>Be specific and clear</v-list-item-title>
              </v-list-item>
              <v-list-item>
                <template v-slot:prepend>
                  <v-icon>mdi-check-circle</v-icon>
                </template>
                <v-list-item-title>Focus on the problem</v-list-item-title>
              </v-list-item>
              <v-list-item>
                <template v-slot:prepend>
                  <v-icon>mdi-check-circle</v-icon>
                </template>
                <v-list-item-title>Explain the benefits</v-list-item-title>
              </v-list-item>
              <v-list-item>
                <template v-slot:prepend>
                  <v-icon>mdi-check-circle</v-icon>
                </template>
                <v-list-item-title>Estimate effort realistically</v-list-item-title>
              </v-list-item>
              <v-list-item>
                <template v-slot:prepend>
                  <v-icon>mdi-check-circle</v-icon>
                </template>
                <v-list-item-title>Add relevant tags</v-list-item-title>
              </v-list-item>
            </v-list>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue';
import { ideasApi } from '../api/ideas';
import { Effort, effortLabels } from '../types';

const effortOptions = [
  { title: effortLabels[Effort.LESS_THAN_ONE_DAY], value: Effort.LESS_THAN_ONE_DAY },
  { title: effortLabels[Effort.ONE_TO_THREE_DAYS], value: Effort.ONE_TO_THREE_DAYS },
  { title: effortLabels[Effort.MORE_THAN_THREE_DAYS], value: Effort.MORE_THAN_THREE_DAYS },
];

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
    errors.title.push('Title must be at least 5 characters');
  }
  if (formData.title.length > 120) {
    errors.title.push('Title must be at most 120 characters');
  }

  if (!formData.description || formData.description.length < 10) {
    errors.description.push('Description must be at least 10 characters');
  }
  if (formData.description.length > 3000) {
    errors.description.push('Description must be at most 3000 characters');
  }

  if (!formData.benefits || formData.benefits.length < 10) {
    errors.benefits.push('Benefits must be at least 10 characters');
  }
  if (formData.benefits.length > 3000) {
    errors.benefits.push('Benefits must be at most 3000 characters');
  }

  if (!formData.effort) {
    errors.effort.push('Effort estimation is required');
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
