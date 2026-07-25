// Global test setup: minimal browser polyfills that happy-dom lacks but Vuetify 3 relies on.
// Registered via vite.config.ts `test.setupFiles`.

// ResizeObserver — used by many Vuetify layout components (app bar, data table, overlays).
if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as any).ResizeObserver = ResizeObserverStub;
}

// matchMedia — used by Vuetify's useDisplay() (breakpoints).
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

// visualViewport — read by Vuetify overlay/positioning logic.
if (typeof window !== 'undefined' && !window.visualViewport) {
  (window as any).visualViewport = {
    width: 1024,
    height: 768,
    scale: 1,
    offsetLeft: 0,
    offsetTop: 0,
    pageLeft: 0,
    pageTop: 0,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  };
}
