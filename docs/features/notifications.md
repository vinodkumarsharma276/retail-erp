# Notifications

## Purpose and scope

A supporting capability, deliberately not a tenant left-rail destination. The desired
outcome is relevant device notifications for authorized users, with safe navigation back
to current API-backed work. **Notifications are the initial desired device capability
for the approved new Flutter app**, not an already delivered push system.
In-app toasts, an installment audit event and a decorative bell are not device delivery.

## Implementation status

| Surface | Status | Evidence / limits |
|---|---|---|
| API | Stub | Authenticated routes return acknowledgments/empty data. No persistence or delivery in the notification service. |
| Web | Placeholder / preference storage | Header bell has no handler; sound/desktop preference checkboxes save preferences but do not deliver notifications. |
| Flutter | Planned | New approved all-authorized-role client; provider, payloads, permissions and delivery implementation remain open. |

Reviewed **2026-11-10** against source, not runtime-certified. Existing Expo is legacy;
comments referring to Expo Push are historical implementation intent, not the approved
Flutter architecture or evidence that push delivery works.

## Business rules and invariants

Current behavior is intentionally limited:

- Registration echoes user/token/device information with “registered (stub)”; it does not
  save a token, enforce uniqueness, bind a device or check provider validity.
- Listing always returns `data: []` with total/totalPages zero and the requested/default
  page/limit. It is not a real inbox, unread count or event history.
- Mark-read returns an acknowledgment with the supplied notification ID; it does not
  validate existence, ownership or persist read state.
- The internal send helper only logs a stub message and returns success.
  No reviewed producer calls it.
- Stored `notificationSound` (default true) and `desktopNotifications` (default false)
  are preferences, not OS authorization, service-worker registration or delivery consent.

Future notification content must not leak customer phones, financial terms or other
protected fields through lock-screen text, payloads or deep links. Recipient selection
must respect the user's current permissions/features and tenant/shop access, rather than
assuming every business event should reach every logged-in role.

## Access, tenancy, and shop scope

All three notification routes run `authenticate`, following global tenant resolution.
They have no notification-specific permission, feature gate or `shopScope`.
Current controllers derive `userId` from the authenticated session rather than accepting
a caller-supplied recipient. That is not yet a persisted ownership boundary because the
service stores nothing.

Future delivery/inbox storage needs explicit tenant and recipient ownership, and shop
context where relevant. It must recheck access when opening a record; receiving an old
notification cannot grant current access. “All authorized roles” for Flutter does not
mean a notification bypasses [authentication and access](authentication-and-access.md).

## User workflows

Current: sign in, save notification preferences on `/preferences`, and optionally call the
stub APIs. Clicking the header bell has no inbox workflow. An empty list or a successful
registration/read response is not evidence that a device is registered or a message sent.

Planned Flutter first slice: request OS authorization in context; register/rotate a
device credential through a real authenticated API; receive a permitted event; tap through
to API-refetched data in the correct tenant/shop; gracefully handle revoked access,
deleted records, logged-out sessions and denied OS permission. Event selection, inbox/read
UX, quiet hours and cross-device behavior require decisions before implementation.

## API contracts and data

Prefix `/api/v1/notifications`, all authenticated:

| Method / path | Input | Actual response / behavior |
|---|---|---|
| POST `/register-token` | Body cast as `{ token: string, deviceId?: string }` | HTTP 200 `{ success: true, data: { success: true, message, userId, token, deviceId } }`; stub, `deviceId` defaults null. |
| GET `/` | Optional string query `page`, `limit`; parsed with `parseInt`, defaults 1/20 | HTTP 200 `{ success: true, data: [], pagination: { page, limit, total: 0, totalPages: 0 } }`. |
| PUT `/:id/read` | String path ID | HTTP 200 `{ success: true, data: { success: true, message, notificationId } }`; stub. |

There are no route-level Zod schemas for these inputs; parsing is not bounds/type
validation. No implemented device unregister, subscription query, send endpoint,
mark-all-read, inbox delete, delivery receipt, retry or badge API is established here.
The reviewed Prisma schema does not define the notification/push-token tables that
service comments propose. Do not build a client contract around those comments.

## Web behavior

The header renders a bell with title/ARIA label “Notifications” and no click handler,
unread indicator or notification query. `/preferences` exposes the two checkbox values
alongside other personal preferences. Auth preferences are shallow-merged into the
current user's JSON by the API; no strict notification-preference schema is applied.
These values do not call browser permission prompts or a push provider in the reviewed UI.

The web/API/mobile source notification search found no additional notification consumer
or mobile token-registration flow. Toast messages report foreground UI outcomes; they
should not be represented as a persisted notification center.

## Mobile behavior and differences

Flutter is the approved new target for **all authorized tenant roles**, eventually with
authorized web parity and staged releases. Initial desired device work is notifications,
but no Flutter delivery is claimed. Provider selection (for example platform push through
a suitable Flutter integration), token lifecycle, notification categories, channel settings,
foreground/background handling and deep-link routing are open implementation decisions.

Legacy Expo code is not the Flutter client and remains unchanged. The backend's Expo-named
stub is not a reason to require Expo in Flutter or preserve its employee-only client policy.
No offline inbox, background synchronization, guaranteed background execution or delivery
guarantee currently exists in this capability.

## Dependencies and cross-feature effects

[Authentication and access](authentication-and-access.md) supplies tenant identity, usable
permissions and shop access. [Settings](settings.md) changes grants that can invalidate a
previous notification's target. [Platform administration](platform-administration.md)
can suspend a tenant or disable a producing feature.

The [installment scheduler](../../apps/api/src/jobs/installments-scheduler.ts) is enabled
only by `ENABLE_SCHEDULER=true`, defaults to `0 1 * * *` in `Asia/Kolkata`, and calls the
promise resolver. The [resolver](../../apps/api/src/jobs/resolve-promises.job.ts) iterates
active tenants, resolves past-date pending promises from qualifying payments and writes
`InstallmentRollLog`. **It does not send push notifications.**
`runDailyRollover` is a retained no-op compatibility entry point, not a delivery scheduler.
Bank-feed scheduling similarly must not be inferred to be notification delivery.

## Code and source references

- API [registration](../../apps/api/src/app.ts),
  [notification routes](../../apps/api/src/modules/notifications/notifications.routes.ts),
  [controller](../../apps/api/src/modules/notifications/notifications.controller.ts),
  [stub service](../../apps/api/src/modules/notifications/notifications.service.ts),
  [schema](../../apps/api/prisma/schema.prisma).
- Web [header](../../apps/web/src/layouts/components/Header.tsx),
  [preferences page](../../apps/web/src/pages/preferences/PreferencesPage.tsx),
  [preference types/defaults](../../packages/shared-types/src/preferences.types.ts).
- Preference persistence: [auth routes](../../apps/api/src/modules/auth/auth.routes.ts),
  [controller](../../apps/api/src/modules/auth/auth.controller.ts),
  [service](../../apps/api/src/modules/auth/auth.service.ts).
- Legacy mobile context: [auth hook](../../apps/mobile/src/hooks/useAuth.ts),
  [auth store](../../apps/mobile/src/stores/auth-store.ts).

## Verification and acceptance

Source review only. No provider, device, browser permission, scheduler execution or delivery
was tested; no runtime certification or notification-specific passing suite is claimed.

Current contract checks for later execution: unauthenticated calls fail; wrong-tenant
tokens fail; registration returns the explicit stub message; listing is empty; read
acknowledgment does not persist state; preferences survive reload without implying delivery.

Future implementation acceptance: OS denial is recoverable; registration persists and
rotation removes obsolete tokens; logout/user change does not leave another user's
subscription active; cross-tenant/cross-user read IDs are refused; recipients cannot receive
disabled-feature/sanitized-sale data; wrong-shop taps are safely resolved or refused;
suspended tenants and revoked grants are honored; duplicate events are idempotent;
delivery failures/retries and invalid tokens are observable; sensitive lock-screen content
is avoided; tap-after-logout requires login; current API state wins over stale payloads.

## Known gaps and next work

Persisted device/inbox models, validated endpoints, real event producers, delivery provider,
retry/receipt observability, recipient authorization, unregister/rotation and Flutter UI
are absent from the current mechanism. The success-shaped stubs must not be used as
acceptance evidence for any of those features. Decide initial event types and privacy
policy before introducing a provider or promising device support.

## Decisions and review checkpoint

2026-11-10: supporting capability, no tenant rail item. Notifications are the initial desired
Flutter device capability; Flutter is new and all-authorized-role, Expo remains legacy
unchanged. Current API behavior is stubbed, separate from approved intent. Source inventory
and hashes belong in `docs/features/checkpoints.json`, intentionally untouched by this task.
