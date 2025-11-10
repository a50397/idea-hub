<template>
  <v-app>
    <v-navigation-drawer v-model="drawer" app>
      <v-list>
        <v-list-item :prepend-avatar="`https://ui-avatars.com/api/?name=${authStore.user?.name}&background=1976D2&color=fff`" :title="authStore.user?.name" :subtitle="authStore.user?.email"></v-list-item>
      </v-list>

      <v-divider></v-divider>

      <v-list density="compact" nav>
        <v-list-item prepend-icon="mdi-view-dashboard" title="Dashboard" :to="{ name: 'Dashboard' }" exact></v-list-item>
        <v-list-item prepend-icon="mdi-lightbulb-on" title="Submit Idea" :to="{ name: 'SubmitIdea' }"></v-list-item>
        <v-list-item prepend-icon="mdi-check-circle" title="Approved" :to="{ name: 'ApprovedIdeas' }"></v-list-item>
        <v-list-item prepend-icon="mdi-progress-clock" title="In Progress" :to="{ name: 'InProgressIdeas' }"></v-list-item>
        <v-list-item prepend-icon="mdi-check-all" title="Completed" :to="{ name: 'CompletedIdeas' }"></v-list-item>

        <v-list-item v-if="authStore.isPowerUser" prepend-icon="mdi-clipboard-check" title="Review Queue" :to="{ name: 'ReviewQueue' }"></v-list-item>

        <v-list-item prepend-icon="mdi-chart-bar" title="Reports" :to="{ name: 'Reports' }"></v-list-item>

        <v-list-item v-if="authStore.isAdmin" prepend-icon="mdi-account-group" title="Users" :to="{ name: 'Users' }"></v-list-item>
      </v-list>

      <template v-slot:append>
        <div class="pa-2">
          <v-btn block @click="handleLogout" prepend-icon="mdi-logout" variant="outlined">
            Logout
          </v-btn>
        </div>
      </template>
    </v-navigation-drawer>

    <v-app-bar app>
      <v-app-bar-nav-icon @click="drawer = !drawer"></v-app-bar-nav-icon>
      <v-toolbar-title>IdeaHub</v-toolbar-title>
      <v-spacer></v-spacer>
      <v-chip class="ma-2" color="primary" label>
        {{ authStore.user?.role }}
      </v-chip>
    </v-app-bar>

    <v-main>
      <router-view />
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const drawer = ref(true);
const router = useRouter();
const authStore = useAuthStore();

async function handleLogout() {
  await authStore.logout();
  router.push({ name: 'Login' });
}
</script>
