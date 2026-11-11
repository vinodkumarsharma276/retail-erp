import { useLocation } from 'react-router-dom';

/**
 * The register list someone came from — its tab, problem, search and page are
 * all in the URL — carried through the details and edit screens, so "back"
 * returns there instead of to a fresh, unfiltered list.
 */
export const REGISTER_URL = '/customer-search';

export interface FromRegister {
  listUrl?: string;
}

/** The list URL to go back to (the plain register when the screen was opened directly). */
export function useRegisterListUrl(): string {
  const state = useLocation().state as FromRegister | null;
  const url = state?.listUrl;
  return url && (url === REGISTER_URL || url.startsWith(`${REGISTER_URL}?`)) ? url : REGISTER_URL;
}
