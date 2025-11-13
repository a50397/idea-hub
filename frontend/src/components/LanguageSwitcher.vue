<template>
  <v-menu>
    <template v-slot:activator="{ props }">
      <v-btn
        v-bind="props"
        icon
        variant="text"
      >
        <v-icon>mdi-translate</v-icon>
      </v-btn>
    </template>
    <v-list>
      <v-list-item
        v-for="lang in languages"
        :key="lang.code"
        :active="locale === lang.code"
        @click="changeLanguage(lang.code)"
      >
        <v-list-item-title>{{ lang.name }}</v-list-item-title>
      </v-list-item>
    </v-list>
  </v-menu>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { locale } = useI18n();

const languages = [
  { code: 'en', name: 'English' },
  { code: 'sk', name: 'Slovenčina' },
];

function changeLanguage(lang: string) {
  locale.value = lang;
  localStorage.setItem('language', lang);
}
</script>
