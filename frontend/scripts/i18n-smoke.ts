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

const PROBES = ['common.appName', 'nav.dashboard', 'dashboard.title', 'auth.signInWithSso'];
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
