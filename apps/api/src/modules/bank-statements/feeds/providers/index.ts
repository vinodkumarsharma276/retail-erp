import { demoProvider } from './demo.js';
import { federalProvider } from './federal.js';
import type { FeedProvider } from './types.js';

export const PROVIDERS: Record<string, FeedProvider> = {
  [federalProvider.id]: federalProvider,
  [demoProvider.id]: demoProvider,
};

/** Provider metadata for the UI (no functions, no secrets). */
export function providerList() {
  return Object.values(PROVIDERS).map((p) => ({
    id: p.id,
    label: p.label,
    banks: p.banks,
    ready: p.ready,
    note: p.note,
    credentialFields: p.credentialFields,
  }));
}

export * from './types.js';
