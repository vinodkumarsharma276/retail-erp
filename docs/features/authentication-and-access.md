# Authentication and access

## Purpose and scope

A supporting capability, deliberately not a tenant left-rail destination. It binds a
tenant user session to one business, resolves usable permissions, selects accessible
shops and restricts sensitive response fields. Tenant login is `/login`; personal
preferences are `/preferences`. Administrative grant editing lives in
[Settings](settings.md); the separate platform identity is documented under
[platform administration](platform-administration.md).

## Implementation status

| Surface | Status | Evidence / limits |
|---|---|---|
| API | Implemented | Tenant resolver, access/refresh tokens, shop membership and shared permission rules; lifecycle caveats below. |
| Web | Implemented | Login, session rehydration, automatic refresh, permission guards and navigation-time permission refresh. |
| Flutter | Foundation implemented | Explicit tenant login, secure credentials, rotating refresh (shared safely with a background isolate), authoritative identity/access loading, offline start with the last confirmed identity, shop selection and logout. Customer Searching is the first business screen; Expo is separate legacy. |

Source-reviewed **2026-11-10**, not runtime-certified. API behavior takes precedence
over client controls, comments, legacy role descriptions and planned mobile behavior.

## Business rules and invariants

- Tenant resolution precedes tenant authentication: explicit nonempty `X-Tenant-Slug`
  wins, then a supported host subdomain. Bare localhost/127.0.0.1/0.0.0.0 uses
  `BOOTSTRAP_TENANT_SLUG` (default `vn`); `star.localhost` selects `star`.
  Production apexes come from `TENANT_APEX_DOMAINS` (default `retailerp.com`).
  Bare production apexes and unsupported/multilabel production subdomains do not silently
  choose a tenant. Missing/unknown tenants return 404; suspended/cancelled tenants return 403.
- Credentials are checked against `(tenantId, username)` and an active user using bcrypt.
  Login chooses the first active assigned shop ordered primary-first, then creation order.
  No active assignment means 403; login does not accept a client-selected shop contract.
- Access JWTs carry user/username/legacy role, tenant, shop and mobile-only claims.
  Tenant authentication checks a supplied JWT tenant claim against the resolved tenant;
  a different tenant is refused with 403.
- Refresh credentials are opaque UUIDs, SHA-256 hashed in storage, valid for seven days,
  tenant-bound, and rotated by revoking the old credential before storing a replacement.
  Logout revokes the submitted refresh token. Password change/reset and user deactivation
  revoke refresh credentials, not already issued access JWTs.
- Usable access is `(role grants ∪ user grants) − user denies`, then disabled-feature
  permissions and missing prerequisites are removed repeatedly until stable.
  Owner is a seeded permission template, not an unconditional route-check bypass.
- Sanitized-sale viewers (`sales.view_sanitized` without `sales.view_real`) lose installment
  and related sensitive routes/permissions through the shared rulebook. Field employees
  without sales access are not automatically treated as sanitized-sale viewers.

## Access, tenancy, and shop scope

Prisma's extension automatically constrains operations on models with `tenantId` and
stamps creates within AsyncLocalStorage tenant context. Outside that context, including
platform operations, it does not do so. Raw SQL is not covered; nested relation inputs
are not a universal tenant-membership validator. Jobs/scripts must explicitly supply
tenant constraints or establish context.

`shopScope` is opt-in per route, not a global property of authenticated routes:

- Without usable `shop.switch`, a header cannot override the JWT shop.
- A specific `X-Shop-Id` override with `shop.switch` must have a current-tenant active
  `UserShop` assignment.
- `X-Shop-Id: all` additionally needs `shops.view_all` or `shop.view_all`; the filter contains
  only active assigned shop IDs. No assignments yields 403. “All shops” never means
  every shop or every tenant.
- Aggregate mode retains the JWT shop as a legacy `shopId` alongside `shopIds/allShops`.
  Services must honor the latter; do not assume every legacy service aggregates correctly.
- `shop.switch` depends on `multi_shop`; all-shop keys depend on `all_shops_view`.

The route's `requirePermission` / `requireAnyPermission` checks usable grants.
The [field filter](../../apps/api/src/middleware/field-access.ts) removes protected keys
recursively by API prefix: product purchase cost/margin/distributor; customer Aadhaar,
phone/guarantor chain; customer-search mobile/raw values; distributor bank/GST/credit;
sale purchase-price/profit; installment interest; transfer prices; shop bank details.
UI column hiding alone is not protection.

## User workflows

1. Open the intended tenant host, submit username/password and receive tokens, user,
   tenant, feature snapshot, usable permissions and the automatically selected shop.
   Correct the tenant host/header rather than retrying another tenant's credentials.
2. Reload the web app with a stored token: `/auth/me` hydrates user, permissions,
   preferences and feature state. A failed initial hydration clears the access token.
3. Select an assigned shop or authorized all-shop view. A single-shop switch can mint a
   new access token through `/auth/switch-shop`; request headers also support selection on
   shop-scoped APIs. Unauthorized or inactive memberships must not yield data.
4. After an administrator edits access, the current page refetches `/auth/me` on navigation;
   API guards remain authoritative even before the UI catches up.
5. Change password with the current password, or log out. On refresh failure the web
   client clears credentials and returns to login instead of retrying indefinitely.

## API contracts and data

Prefix `/api/v1/auth`; normal responses use `{ success: true, data }`, errors
`{ success: false, error }`. Public means no bearer token, not no tenant resolution.

| Method / path | Contract / guard |
|---|---|
| GET `/shops` | Public tenant-active shop dropdown, `{ id, name, code }`; not user-specific assignments. |
| POST `/login` | Public; Zod nonempty username/password. Returns access/refresh tokens, user, tenant, features, permissions, selected shop. |
| POST `/refresh` | Public; nonempty `refreshToken`; validates tenant and stored expiry/revocation, rotates credentials, selects active assigned shop. |
| GET `/me` | Authentication; current DB user, assigned shops, tenant, feature snapshot, usable permissions and preferences. |
| GET `/preferences` | Authentication; current user's preferences JSON or `{}`. |
| PUT `/preferences` | Authentication; shallow-merges the submitted object into existing preferences; no strict preference-key/value schema here. |
| POST `/logout` | Authentication plus nonempty `refreshToken`; revokes that refresh credential. |
| PUT `/change-password` | Authentication; both current and new password at least six characters. Wrong current password returns 400. |
| POST `/switch-shop` | Authentication and UUID `shopId`; controller additionally checks usable `shop.switch` and tenant membership; returns replacement access token and shop. |

Role grants and user overrides use `Role`, `Permission`, `RolePermission`, `UserPermission`;
membership uses `UserShop`. The role enum remains for legacy behavior but `roleId` drives
DB grants. The override editor's returned `effective` field is only the raw grant-minus-deny
set; `/auth/me` applies feature/prerequisite filtering and is the client authority for
what can actually be used.

Role/user permission caches expire after **60 seconds**. Role permission replacement or
role deletion clears that role and all user-cache entries; role assignment and override
saves clear the affected user. Invalidation is process-local, so script/other-instance
changes can wait for TTL. Feature and tenant-resolution caches separately use 60-second
TTLs and platform mutation invalidation. Do not promise instantaneous fleet-wide revocation.

## Web behavior

The tenant API client derives tenant from host/environment, attaches bearer, tenant and
selected-shop headers, trims JSON/query strings and queues concurrent 401 requests behind
one refresh attempt. Tenant tokens are held in browser localStorage and in-memory stores.
`ProtectedRoute` runs `/auth/me` while a token exists, invalidates it on navigation, and
syncs permissions/features/preferences. `PermissionGuard` checks usable grants; the rail
uses separate `nav.*` grants. A hidden rail item is not proof the API is forbidden.

Settings permission saves explicitly invalidate current-session `['auth', 'me']`.
Other signed-in sessions see changes when they refetch and cache TTLs permit; there is no
push-based permission broadcast. `/preferences` is available to every authenticated
tenant user without a Settings grant.

## Mobile behavior and differences

Flutter is the approved **new** client, eventually covering web workflows for **all
authorized tenant roles**, preserving the same tenant headers, membership checks,
feature/prerequisite filtering and field restrictions. Staging does not change server policy.
The [Flutter foundation](../../apps/mobile-flutter/README.md) implements explicit tenant login
and LAN/HTTPS API configuration, encrypted API/tenant/token/shop persistence, startup `/auth/me`,
single-flight refresh rotation, one bounded 401 retry, shop switching and server logout with
local cleanup. Passwords are not stored or trimmed. Server changes clear the saved credentials;
stale requests cannot repopulate a cleared session. Storage/network/server errors are visible.

The Modules/Account shell uses effective grants and feature flags, including `mobile_app`.
Foreground/manual revalidation blocks protected UI when the server answers with a failure.
When the server **cannot be reached**, the app continues with the last server-confirmed identity
(saved in secure storage, removed on sign-out) and shows an offline banner — an owner decision
for offline Customer Searching reads (2026-11-10), with no time limit; server checks still
decide every request, and a disconnected device only learns of revoked access when it next
reaches the server. Offline writes remain absent.

Current Expo is legacy: its login store only permits `employee` plus `isMobileOnly`.
It submits a chosen `shopId` even though the current API login validator/controller chooses
the assigned shop itself, and its restore flow expects an older `/auth/me` shape.
These are compatibility caveats, not proof of Flutter restrictions or working mobile parity.
No Expo deletion or application change is part of this documentation.

## Dependencies and cross-feature effects

[Settings](settings.md) edits grants/assignments;
[platform administration](platform-administration.md) sets tenant status and feature flags.
[Notifications](notifications.md) must reuse these boundaries when delivery is implemented.
The shared rulebook governs all modules, including sanitized sales/installments and
customer-search prerequisites. New permission keys need catalog, prerequisite/feature
mapping, default-role policy and existing-tenant catalog synchronization together.

## Code and source references

- [Auth routes](../../apps/api/src/modules/auth/auth.routes.ts),
  [controller](../../apps/api/src/modules/auth/auth.controller.ts),
  [service](../../apps/api/src/modules/auth/auth.service.ts),
  [validators](../../apps/api/src/modules/auth/auth.validation.ts).
- [Tenant resolver](../../apps/api/src/middleware/tenant-resolver.ts),
  [JWT authentication](../../apps/api/src/middleware/auth.ts),
  [shop scope](../../apps/api/src/middleware/shop-scope.ts),
  [permissions/cache](../../apps/api/src/middleware/permissions.ts),
  [feature snapshot/gate](../../apps/api/src/middleware/feature-gate.ts),
  [database extension](../../apps/api/src/config/database.ts).
- [Access rulebook](../../packages/shared-types/src/access.ts),
  [permission catalog/templates](../../packages/shared-types/src/permissions.ts),
  [feature catalog](../../packages/shared-types/src/features.ts),
  [catalog synchronization](../../apps/api/prisma/seed/sync-permission-catalog.ts),
  [schema](../../apps/api/prisma/schema.prisma).
- Web [API client](../../apps/web/src/lib/api-client.ts),
  [session guard](../../apps/web/src/routes/ProtectedRoute.tsx),
  [permission guard](../../apps/web/src/routes/PermissionGuard.tsx),
  [auth queries](../../apps/web/src/hooks/useAuth.ts).
- Legacy Expo [auth hook](../../apps/mobile/src/hooks/useAuth.ts),
  [auth store](../../apps/mobile/src/stores/auth-store.ts).
- Flutter [client](../../apps/mobile-flutter/lib/core/api_client.dart),
  [session controller](../../apps/mobile-flutter/lib/core/session_controller.dart),
  [secure store](../../apps/mobile-flutter/lib/core/session_store.dart),
  [login page](../../apps/mobile-flutter/lib/features/auth/login_page.dart) and
  [session tests](../../apps/mobile-flutter/test/session_test.dart).

## Verification and acceptance

Backend descriptions are source-reviewed. Flutter analysis, synthetic HTTP/session/storage
adapter/widget tests and an Android debug build passed. These are not a live ERP login
certification; API/PostgreSQL were not running. iOS build/Keychain requires a Mac.
The Android app was installed/launched and its real login form was verified on-device; the
smoke build's example server address must be replaced with a reachable LAN API for live login.
Existing [access-rule unit tests](../../apps/api/tests/unit/access-rules.test.ts) and
[tenant-isolation integration tests](../../apps/api/tests/integration/tenant-isolation.test.ts)
are starting points, not a certification of every lifecycle path.

Later acceptance should check: header-over-host tenant selection; unknown/suspended tenants;
same username in two tenants; tenant-token mismatch; missing/expired bearer; refresh rotation
and reuse; no active shop; unauthorized/inactive shop override; assigned-only all-shop results;
role plus grant plus deny combinations; prerequisite removal; disabled features; sanitized
sale users unable to reach installment data; sensitive fields absent from JSON, not only UI;
navigation updating grants; multi-process cache expiry; logout/reset behavior until access JWT
expiry; preferences partial merge without overwriting unrelated keys.

## Known gaps and next work

Authentication middleware verifies token claims but does not reload the user's active state
on each request. Refresh lookup includes the user but the current refresh controller does
not explicitly reject an inactive user; dedicated deactivation revokes tokens, while generic
user update must not be assumed equivalent. No server-wide access-token revocation registry,
MFA, account recovery or session-management UI is established by these reviewed routes.

Do not treat `role.isActive`, a changed legacy role enum or a missing `roleId` as a proven
permission lifecycle: the permission loader reads `roleId` grants, not enum templates.
Platform JWT middleware explicitly requires platform scope; tenant middleware does not
symmetrically validate an explicit tenant scope or reject absent tenant claims. Do not claim
perfect bidirectional token-kind isolation solely from the separate client apps.

## Decisions and review checkpoint

2026-11-10: supporting capability, no additional tenant rail item. API and shared access
rulebook are authoritative. Flutter is approved for all authorized roles, not restricted
by employee-only legacy Expo policy. This is source review, not runtime certification.
The shared Flutter implementation is now the foundation for all feature chats; reuse it.
Machine-readable source inventory/hashes are maintained through the feature checkpoint workflow.
