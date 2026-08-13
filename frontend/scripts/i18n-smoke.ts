/**
 * Runtime i18n smoke check — run with: npx vite-node scripts/i18n-smoke.ts
 *
 * Executes the app's real i18n setup through the actual Vite pipeline
 * (resolve.alias → vue-i18n RUNTIME build, unplugin-vue-i18n precompilation),
 * i.e. exactly what the browser gets in dev/prod — unlike vitest, which
 * aliases the full compiler build and imports the raw catalogs.
 *
 * Exits non-zero if any probed key fails to resolve to a translated string.
 */
;(globalThis as any).localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

const { default: en } = await import('../src/i18n/en');
console.log(
  'catalog transform check: typeof common.appName =',
  typeof (en as Record<string, any>).common?.appName,
  '(string = NOT precompiled, function/object = precompiled)'
);

const { default: i18n } = await import('../src/i18n');

const PROBES = [
  'common.appName',
  'nav.dashboard',
  'dashboard.title',
  'auth.signInWithSso',
  // Webex-spaces department control keys (added with feat/webex-dept-spaces).
  'departments.webexRoomIds',
  'departments.webexRoomIdsHint',
  'departments.webexRoomIdsUnavailable',
  'departments.webexRoomsEmpty',
  'departments.webexRoomsLoading',
  'departments.tooManyWebexRoomIds',
  'departments.webexRoomIdTooLong',
  // Org-wide idea visibility: paged-list load failure + capped CSV export.
  'ideas.loadFailed',
  'reports.exportTruncated',
  // Jira background-sync failure surfacing. jiraSettings.syncFailing is the only
  // INTERPOLATED key of the three ({since}/{reason}) — the message-compiler class
  // this script exists to catch.
  'jiraSync.failingBanner',
  'jiraSync.failingBannerLink',
  'jiraSettings.syncFailing',
  // Main Jira-integration namespace (deep-review gap: the catalogs grew a whole
  // feature with no runtime probe). createJiraTaskSuccess carries {key} — the
  // interpolated / message-compiler class this script exists to catch.
  'jiraSettings.title',
  'jiraSettings.testReason.invalid_credentials',
  'ideas.createJiraTask',
  'ideas.createJiraTaskSuccess',
  'events.actorJira',
  'events.actorConnective',
  'dashboard.jiraStatuses',
  'reports.headerJira',
];
let failed = false;

for (const locale of ['en', 'sk'] as const) {
  // @ts-expect-error runtime write on composer locale ref
  i18n.global.locale.value = locale;
  for (const key of PROBES) {
    const value = i18n.global.t(key);
    const ok = value && value !== key;
    if (!ok) failed = true;
    console.log(`${ok ? 'OK  ' : 'FAIL'} [${locale}] ${key} = ${JSON.stringify(value)}`);
  }
}

if (failed) {
  console.error('\ni18n smoke check FAILED — catalog not resolving at runtime');
  process.exit(1);
}
console.log('\ni18n smoke check PASSED');
