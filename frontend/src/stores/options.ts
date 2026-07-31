import { defineStore } from 'pinia';
import { ref } from 'vue';
import { optionsApi } from '../api/options';

// Runtime UI flags for the authenticated app (GET /api/options). Both flags are
// runtime-mutable — an admin can toggle mail at any time and the deployment sets
// SSO_SHOW_LOGOUT — so consumers fetch() on mount. A failed fetch silently degrades
// EVERY flag to false: the same fail-safe the per-page status read gave before this
// store existed (a hidden notify toggle, a hidden SSO logout button).
export const useOptionsStore = defineStore('options', () => {
  const mailEnabled = ref(false);
  const ssoShowLogout = ref(false);

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
      ssoShowLogout.value = options.ssoShowLogout;
    } catch {
      // Fail-safe: reset every flag to false so nothing gated on them is exposed
      // when the flags cannot be read. No error is surfaced (best-effort).
      mailEnabled.value = false;
      ssoShowLogout.value = false;
    }
  }

  return { mailEnabled, ssoShowLogout, fetch };
});
