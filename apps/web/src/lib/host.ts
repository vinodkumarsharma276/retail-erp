/**
 * Hostname helpers — decide whether the current browser session belongs
 * to the platform-admin app (`admin.retailerp.com`) or a tenant app
 * (`<slug>.retailerp.com`, `vn.localhost`, etc.).
 *
 * The platform-admin app is mounted in the same Vite bundle as the
 * tenant app; `App.tsx` reads `isPlatformAdminHost()` once at module
 * load and renders either the `PlatformApp` router or the tenant
 * router. There is no overlap — a hostname is either platform-admin
 * or tenant, never both.
 *
 * Local dev convenience: `admin.localhost:5173` works without DNS
 * config on macOS/Linux (loopback covers it). Windows users need an
 * entry in `C:\Windows\System32\drivers\etc\hosts`:
 *   127.0.0.1 admin.localhost
 *   127.0.0.1 vn.localhost
 */

const APEX_DOMAINS = (
  (import.meta.env.VITE_TENANT_APEX_DOMAINS as string | undefined) ?? 'retailerp.com'
)
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

/**
 * Subdomain reserved for platform-admin operators. Configurable via env
 * for future white-labelling (e.g. `console.<apex>`).
 */
const PLATFORM_ADMIN_SUBDOMAIN = (
  (import.meta.env.VITE_PLATFORM_ADMIN_SUBDOMAIN as string | undefined) ?? 'admin'
)
  .trim()
  .toLowerCase();

/**
 * Optional env override — set `VITE_FORCE_PLATFORM_ADMIN=true` to mount
 * the platform-admin app even from `localhost` (useful when working on
 * the platform UI without setting up a hosts-file alias).
 */
const FORCE_PLATFORM_ADMIN =
  String(import.meta.env.VITE_FORCE_PLATFORM_ADMIN ?? '').toLowerCase() === 'true';

/** True when the current host is the platform-admin entrypoint. */
export function isPlatformAdminHost(): boolean {
  if (FORCE_PLATFORM_ADMIN) return true;
  const host = (typeof window !== 'undefined' ? window.location.hostname : '').toLowerCase();
  if (!host) return false;

  // `admin.localhost` for dev.
  if (host === `${PLATFORM_ADMIN_SUBDOMAIN}.localhost`) return true;

  // `admin.<apex>` for prod / staging.
  for (const apex of APEX_DOMAINS) {
    if (host === `${PLATFORM_ADMIN_SUBDOMAIN}.${apex}`) return true;
  }
  return false;
}

/** Useful for status text / nav links. */
export const PLATFORM_ADMIN_HOST_SUFFIX = PLATFORM_ADMIN_SUBDOMAIN;
