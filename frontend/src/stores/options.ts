import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { optionsApi } from '../api/options';

// Runtime UI flags for the authenticated app (GET /api/options). Every flag is
// runtime-mutable — an admin can toggle mail or Webex at any time and the
// deployment sets SSO_SHOW_LOGOUT — so consumers fetch() on mount. A failed fetch
// silently degrades EVERY flag to false: the same fail-safe the per-page status
// read gave before this store existed (a hidden notify toggle, a hidden SSO logout
// button).
export const useOptionsStore = defineStore('options', () => {
  const mailEnabled = ref(false);
  const webexEnabled = ref(false);
  // Whether the Jira execution channel is effectively enabled. Gates the
  // "Create Jira task" button; independent of notifyEnabled below (which is
  // mail/webex only).
  const jiraEnabled = ref(false);
  // Whether the Jira background poller is currently failing. Drives the admin
  // warning banner in MainLayout. The server sends this flag to ADMIN sessions
  // ONLY: for any other role the key is absent, which reads as false below — a
  // non-admin therefore never sees the banner and never learns the flag exists.
  const jiraSyncFailing = ref(false);
  const ssoShowLogout = ref(false);

  // The per-idea notify toggle is channel-agnostic: it is meaningful as soon as ANY
  // notification channel is effectively enabled. Consumers gate the toggle on this
  // instead of a single channel's flag.
  const notifyEnabled = computed(() => mailEnabled.value || webexEnabled.value);

  // MainLayout and the idea pages all fetch() on mount, so overlapping calls are
  // routine. Sharing one in-flight request keeps a late-failing duplicate from
  // resetting flags a concurrent successful read just set; sequential calls
  // (remounts) still re-read the runtime-mutable flags.
  let inFlight: Promise<void> | null = null;

  function fetch(): Promise<void> {
    if (!inFlight) {
      inFlight = doFetch().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  }

  async function doFetch(): Promise<void> {
    try {
      const options = await optionsApi.get();
      mailEnabled.value = options.mailEnabled;
      webexEnabled.value = options.webexEnabled;
      jiraEnabled.value = options.jiraEnabled;
      // Absent for every non-admin role — treated as "not failing" (see above).
      jiraSyncFailing.value = options.jiraSyncFailing ?? false;
      ssoShowLogout.value = options.ssoShowLogout;
    } catch {
      // Fail-safe: reset every flag to false so nothing gated on them is exposed
      // when the flags cannot be read. No error is surfaced (best-effort).
      mailEnabled.value = false;
      webexEnabled.value = false;
      jiraEnabled.value = false;
      jiraSyncFailing.value = false;
      ssoShowLogout.value = false;
    }
  }

  return {
    mailEnabled,
    webexEnabled,
    jiraEnabled,
    jiraSyncFailing,
    ssoShowLogout,
    notifyEnabled,
    fetch,
  };
});
