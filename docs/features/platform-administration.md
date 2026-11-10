# Platform administration

## Purpose and scope

A supporting operational capability, deliberately **not** on the tenant left rail and
not a Settings tab. A separate admin-host SPA manages tenants, plans and overrides.
Its own navigation is **Tenants** (`/tenants`) and **Plans** (`/plans`), with onboarding
at `/tenants/new`, tenant detail at `/tenants/:id`, and its own `/login`.
Tenant owners/admins do not acquire this identity from their tenant role.

## Implementation status

| Surface | Status | Evidence / limits |
|---|---|---|
| API | Implemented, provisioning gaps | Separate platform auth, tenant onboarding/update, owner reset, plans and feature overrides; readiness caveats below. |
| Web | Implemented | Separate SPA with tenant filters, onboarding wizard, tenant details and plan editor. |
| Flutter | Planned target, platform scope open | New Flutter targets all authorized tenant roles and eventual authorized web parity; platform identity remains separate and a platform-admin mobile release is not established. |

Source-reviewed **2026-11-10**, not runtime-certified. API is authoritative; service comments
and successful create responses do not prove a new tenant can perform authorized work.

## Business rules and invariants

- Platform users and refresh credentials use `PlatformUser` / `PlatformRefreshToken`,
  separate from tenant `User` / `RefreshToken`. Login checks active platform user and bcrypt.
  JWTs carry `scope: 'platform'`; platform middleware explicitly rejects tenant tokens.
- Refresh credentials are UUIDs stored as SHA-256 hashes, expire after seven days and rotate.
  Access JWT expiry follows the controller/configured JWT settings; logout revokes the
  refresh credential, not an issued access JWT.
- Tenant onboarding resolves a plan and checks slug uniqueness, then transactionally
  creates tenant, owner, optional initial shop/primary assignment and platform audit row.
  Trial expiry supplied means status `trial`, otherwise `active`.
  The supplied owner password is hashed; the response returns owner identity, not that
  plaintext password. The wizard's success screen reuses its local form password.
- Optional shop really is optional in the API, but tenant login requires an active assigned
  shop. Onboarding without it cannot immediately satisfy login.
- Owner creation sets the legacy `role: 'owner'` but does **not** seed tenant roles or bind
  `roleId`. Permission loading reads `roleId`; successful onboarding does not imply usable
  owner grants. Treat this as a confirmed provisioning gap, not completed readiness.
- Tenant statuses are `active`, `trial`, `suspended`, `cancelled`; the tenant resolver
  blocks the last two. The reviewed resolver does not automatically expire a trial from
  `trialEndsAt`.
- Features resolve tenant override first, plan default second, otherwise disabled.
  Deleting an override means inherit again, not force-enable. `valueJson` carries optional
  limit/config objects; existence is not proof that consuming modules enforce a limit.
- New plans seed every known feature disabled. Plan prices are nonnegative numeric inputs
  persisted as monetary fields; changing a price is not charging, invoicing or payment
  collection.
- Owner reset selects the oldest active user with legacy role `owner`, hashes a generated
  temporary password, revokes that user's refresh tokens, audits the action and returns
  `{ username, temporaryPassword }`. No forced-first-login change flow is established.

## Access, tenancy, and shop scope

`/api/v1/platform/*` bypasses tenant resolution and has no tenant AsyncLocalStorage context.
Platform services therefore explicitly identify tenants when accessing tenant-owned data.
Platform mutation guards are `platformAuthenticate`, not tenant `requirePermission`,
`shopScope` or a tenant feature flag. Platform login/refresh/logout are exceptions described
below. No granular platform-admin role/permission layer is implemented in these routes.

Tenant owner/admin accounts are not platform administrators. Conversely, do not claim
perfect bidirectional token-kind separation: platform middleware checks scope, whereas
tenant authentication does not symmetrically require a tenant scope; see
[authentication and access](authentication-and-access.md).

Tenant updates invalidate the tenant resolver's slug cache and that tenant's feature cache.
Tenant override upsert/delete invalidates its feature cache; plan update/feature mutation
clears feature caches globally. These are process-local caches with 60-second expiry.
Tenant clients refresh features/usable permissions through `/auth/me`; UI visibility does
not itself invalidate or grant server access.

## User workflows

1. Open the admin host and sign in with a platform identity. `/` redirects to `/tenants`.
   A tenant login/token is not enough for platform APIs.
2. Filter tenants by status or search name/slug/contact email; open a detail page showing
   counts for shops/users/customers/sales.
3. Onboard through tenant details, owner details, optional first shop and review steps.
   Submit once and share credentials through an appropriate private channel. Resolve
   duplicate slug or unknown plan errors; verify shop assignment and role provisioning
   before declaring the tenant ready.
4. Edit tenant name/contact/GST/status/plan/custom-domain metadata. Suspend/cancel to block
   tenant API access. Changing metadata does not provision DNS or custom-domain routing.
5. Toggle a tenant feature to create an override; use **Reset to plan** to delete it.
   Confirm inherited source and tenant-side access after refresh.
6. Create a plan, edit display/pricing/public/active values and toggle its feature defaults.
   A new plan starts disabled; enable intended modules explicitly.
7. Reset owner credentials when necessary, handle the returned temporary password privately
   and confirm old refresh tokens no longer work.

## API contracts and data

Prefix `/api/v1/platform`; standard `{ success, data }` / `{ success: false, error }`
responses. Creation returns 201. Tenant list accepts `status` and `q`; the service returns
the matching collection, not a paginated contract.

| Method / path | Actual guard / input |
|---|---|
| POST `/auth/login` | Public, Zod username/password; returns tokens and platform user. |
| POST `/auth/refresh` | Public, Zod nonempty `refreshToken`; rotates a valid platform credential. |
| POST `/auth/logout` | No platform-auth or route Zod guard; controller revokes supplied `refreshToken`. |
| GET `/auth/me` | Platform JWT; returns identity derived from authenticated platform claims. |
| GET `/tenants`; GET `/tenants/:id` | Platform JWT; list/detail with plan/counts, detail includes features. |
| POST `/tenants` | Platform JWT + create schema; tenant, owner and optional first-shop object. |
| PATCH `/tenants/:id` | Platform JWT + update schema; tenant metadata/status/plan/trial date/custom domain. |
| GET `/tenants/:id/features` | Platform JWT; merged feature rows with `source: plan or override`, value and note. |
| POST `/tenants/:id/features` | Platform JWT + schema `{ featureKey, enabled, valueJson?, note? }`. |
| DELETE `/tenants/:id/features/:featureKey` | Platform JWT; removes override, records audit and invalidates cache. |
| POST `/tenants/:id/reset-owner-password` | Platform JWT; generated password response; no caller password input. |
| GET `/plans`; GET `/plans/:code` | Platform JWT; plan definitions/features and tenant count. Detail uses code, not ID. |
| POST `/plans` | Platform JWT + create schema; code/name, description, monthly/yearly prices, public/active flags. |
| PATCH `/plans/:id` | Platform JWT + partial create schema; service updates name/description/prices/public/active, not code. |
| POST `/plans/:id/features` | Platform JWT + schema `{ featureKey, enabled, valueJson? }`. |

Tenant slug is 2–63 lowercase letter/digit/hyphen characters starting with a letter;
name at most 200; optional contact email/phone and 15-character GST. Owner requires
username, full name, phone and password of at least eight characters.
First shop requires code/name, 15-character GST, 10-character PAN, address/city/state,
six-character pincode and phone. `trialEndsAt` is nullable ISO datetime.

Feature keys are validated as nonempty strings up to 100, not an enum of known catalog
keys; `valueJson` is optional nullable object JSON and note up to 1,000 characters.
Models are `Tenant`, `Plan`, `PlanFeature`, `TenantFeature`, the separate platform identity
tables and `PlatformAuditLog`. Mutation audit coverage is implemented for tenant creation,
update, feature changes, owner reset and plan changes, not a general audit-browser API.
There are no tenant/plan DELETE routes or subscription-payment endpoints in this module.

## Web behavior

`App.tsx` branches to `PlatformApp` based on platform-host selection; routes live separately
from the tenant SPA. `PlatformProtectedRoute` uses platform token storage and
`/platform/auth/me` for hydration; its keys are `platformAccessToken` /
`platformRefreshToken`, distinct from tenant token keys.

The wizard validates steps, shows API errors, supports optional initial-shop entry and a
success credential handoff. Tenant detail edits metadata/status/plan and displays owner
reset plus boolean feature override controls with inherited/override labels.
Plan Manager lists plans and exposes pricing/status/details and feature toggles.
The API's `valueJson`/notes are richer than these simple toggle UIs; do not infer a complete
capacity-settings editor or custom-domain provisioning from their data fields.

## Mobile behavior and differences

The approved new Flutter target covers **all authorized tenant roles**, with staged
eventual parity for authorized tenant web workflows, not the legacy Expo employee-only
client policy. Platform administrators are a different identity class, not another tenant
role. Whether to ship a separate Flutter platform-admin surface, and when, remains open;
no platform-admin mobile implementation is claimed.
Any future admin surface must preserve separate credentials and high-impact confirmations.
No offline plan/tenant mutations or background administrative sync are assumed.

## Dependencies and cross-feature effects

Plan flags feed route gates and the shared access rulebook in
[authentication and access](authentication-and-access.md). `dynamic_forms` and
`custom_roles` gate [Settings](settings.md) mutations while preserving their reads.
`mobile_app` currently gates employee APIs; it is not evidence that the planned Flutter
app already has an agreed global entitlement policy.
[Notifications](notifications.md) is planned device delivery and must respect suspended
tenants, feature removal and recipient permissions.

Onboarding must coordinate permission-catalog/role seeding, active shop assignment and
tenant login readiness. A plan update can affect many tenants simultaneously, while tenant
overrides remain higher priority. Changing a feature does not remove existing business data.

## Code and source references

- API [routes](../../apps/api/src/modules/platform/platform.routes.ts),
  [controller](../../apps/api/src/modules/platform/platform.controller.ts),
  [services](../../apps/api/src/modules/platform/platform.service.ts),
  [validation](../../apps/api/src/modules/platform/platform.validation.ts),
  [platform JWT guard](../../apps/api/src/middleware/platform-auth.ts),
  [registration](../../apps/api/src/app.ts), [schema](../../apps/api/prisma/schema.prisma).
- Cross-cutting [tenant resolver](../../apps/api/src/middleware/tenant-resolver.ts),
  [feature snapshot/cache](../../apps/api/src/middleware/feature-gate.ts),
  [permission loader](../../apps/api/src/middleware/permissions.ts),
  [feature catalog](../../packages/shared-types/src/features.ts).
- Web [tenant/platform branch](../../apps/web/src/App.tsx),
  [platform router](../../apps/web/src/PlatformApp.tsx),
  [platform route guard](../../apps/web/src/routes/PlatformProtectedRoute.tsx),
  [login](../../apps/web/src/pages/platform/PlatformLoginPage.tsx),
  [tenant list](../../apps/web/src/pages/platform/TenantListPage.tsx),
  [onboarding](../../apps/web/src/pages/platform/TenantOnboardPage.tsx),
  [tenant detail](../../apps/web/src/pages/platform/TenantDetailPage.tsx),
  [plan manager](../../apps/web/src/pages/platform/PlanManagerPage.tsx).

## Verification and acceptance

Source inspection only; no onboarding, password reset, tests, deployment or provider calls
performed. Existing [tenant-isolation tests](../../apps/api/tests/integration/tenant-isolation.test.ts)
and [access-rule tests](../../apps/api/tests/unit/access-rules.test.ts) are related starting
points, not platform provisioning certification.

Later acceptance cases:

- Missing/expired platform token fails; tenant token fails platform guards; platform-host
  routing never accidentally displays the tenant app.
- Duplicate slug, unknown plan, malformed GST/owner password and invalid trial datetime
  fail predictably; failed transactional create leaves no partial tenant/owner/shop/audit.
- Verify new owner login with/without an initial shop and verify usable role grants,
  explicitly exposing the missing-role provisioning gap rather than assuming success.
- Suspending/cancelling blocks tenant APIs; plan/override changes propagate after relevant
  cache invalidation/expiry and `/auth/me` refresh.
- Reset override restores plan behavior, including disabled defaults; new plan starts with
  disabled features. Test one plan change affecting two tenants with different overrides.
- Owner reset returns a temporary credential, old refresh tokens fail, and remaining
  access-token lifetime is understood. Missing active owner is handled.
- Audit entries omit plaintext passwords; custom-domain metadata does not assert routing;
  capacity values do not claim enforcement absent a consuming service.

## Known gaps and next work

Provisioning does not seed permission roles/bind owner `roleId`; omitting the first shop
also prevents immediate login, and the tenant shop module has no create route to supply
the presumed “create later” workflow. Fix/verify readiness before onboarding real customers.
Capacity limits, trial-expiry automation, billing/payment collection, DNS/custom-domain
activation, platform-user management, granular platform authorization and an audit viewer
are not supplied by these routes.

Refresh and per-request platform middleware do not reload active-account state on every
request; do not claim instant platform-user deactivation or full session revocation.
Tenant/plan audit writes outside onboarding are not all part of the same transaction as
their business mutation. Error recovery and audit atomicity require runtime verification.

## Decisions and review checkpoint

2026-11-10: platform administration remains a separate identity/app and not a tenant rail
feature. Flutter is the approved all-authorized-tenant-role target; platform-admin mobile
scope is an open separate decision, not a reason to conflate identities. Expo is legacy
and unchanged. This source review is not runtime certification. Machine inventory/hashes
belong in `docs/features/checkpoints.json`, intentionally untouched here.
