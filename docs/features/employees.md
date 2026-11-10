# Employees

## Purpose and scope

Maintain shop employee profiles linked to existing user accounts and explain the separate
employee collection-access contract. Web left rail **Employees** opens `/employees`, with
`/employees/new` and `/employees/:id/edit`. There is no separate employee detail screen.
This is not payroll processing, attendance, GPS tracking or an implemented route-planning product.
[Installment](installment.md) owns collection schedules/payments; [Customers](customers.md)
owns contact identities.

## Implementation status

| Surface | Status | Evidence / limits |
|---|---|---|
| API | Partial personnel module | [Routes](../../apps/api/src/modules/employees/employees.routes.ts), [service](../../apps/api/src/modules/employees/employees.service.ts): list/detail/create/update only. Collections use installment APIs. |
| Web | Implemented profile list/create/edit | [List](../../apps/web/src/pages/employees/EmployeeListPage.tsx), [form](../../apps/web/src/pages/employees/EmployeeFormPage.tsx); no assignment/history/location screen established by these routes. |
| Flutter | Planned | New app for all authorized roles with staged authorized web parity. Existing Expo employee collections are legacy implementation, not Flutter. |

Reviewed **2026-11-10**, current source/dirty worktree only; not runtime-certified.

## Business rules and invariants

- `Employee` links one existing tenant `User` (`userId` unique) to a shop and optional designation,
  joining date, salary, Aadhaar, address and emergency contact. Creating a profile neither creates
  a login nor assigns a role/permission.
- Creation verifies user existence and rejects a second profile for the same user (409).
  It does not check the user's role is `employee`, or validate that user's shop membership against
  the profile shop. The term employee profile and JWT employee role are not interchangeable.
- List returns active employee profiles only, newest first. Joined user `isActive` is a different
  field; deactivating a profile does not deactivate the user account.
- Update can set nullable fields and `isActive`; it cannot relink user or move shop.
  There is no DELETE, payroll payout or employee self-service API in this module.
- `EmployeeCollectionAssignment.employeeId` is a **User ID**, used by installment queries,
  not the personnel `Employee.id`. Collection filters match active assignments.
- Collection payments store the acting user as collector. Merely creating a personnel profile
  does not assign that user schedules or grant installment permissions.

## Access, tenancy, and shop scope

- Feature `mobile_app` gates `/api/v1/employees` and usable `employees.*` permissions, despite
  these profiles also being managed on the web. It is not proof of a Flutter implementation.
- Route guards are `employees.list` for list/detail, `employees.create` for create and
  `employees.edit` for update; each runs authentication and shop middleware.
  `employees.deactivate` exists in the catalog but update's `isActive` is guarded by edit, not by
  a separate deactivate check.
- Actual usable permissions follow [shared access](../../packages/shared-types/src/access.ts):
  grants minus denies/disabled features/missing prerequisites. Do not infer access from default
  admin/accountant/employee labels.
- List/create use **single** `shopFilter.shopId`. Employee list does not fan out over `shopIds`
  in all-shops mode, unlike sales/customer lists. Detail/update use tenant-filtered IDs without
  comparing target profile shop to selected shop; middleware only checks access to the request shop.
- [Tenant Prisma](../../apps/api/src/config/database.ts) filters/stamps tenant data.
  [Shop middleware](../../apps/api/src/middleware/shop-scope.ts) validates active tenant shop membership
  and permission-based switching; it does not supply missing service target checks.
- [Field filter](../../apps/api/src/middleware/field-access.ts) has no employee-prefix salary or
  Aadhaar rule. Do not claim those fields are server-redacted by customer Aadhaar permissions.
- Collection date/today/range endpoints require `installments.tab.todays_scheduled` and feature
  `installments`. For JWT role exactly `employee`, controllers override requested `employeeId`
  with the current **user ID**, limiting those lists to active assignments in scoped shops.
  This legacy role-specific data filter exists even though route authorization is permission-based.
- Other installment capabilities use their own permissions: `installments.list`, `.detail`,
  `.record_payment`, `.payment_timeline`, `.tab.all_overdue`, `.tab.search`, etc.
  **Do not generalize assignment filtering:** call-list/overdue/search/detail/payment handlers
  are not all filtered by employee assignment, and ID-based payment does not compare the
  target schedule shop to `shopFilter`. See [Installment](installment.md).
- Collectors without sales access can retain installment permissions; the rulebook removes
  installment access from sanitized sales viewers, not indiscriminately from everyone lacking
  `sales.view_real`.

## User workflows

1. Provision the login/permissions and shop access through user administration separately.
2. Select a shop, create an employee profile linked to that user, enter optional employment/contact
   fields, then save. Missing user is 404; duplicate link is 409.
3. Search active profiles, edit details and, through the API, deactivate/reactivate if authorized.
   Do not assume the standard form implements activation controls.
4. Collector signs in to the legacy collection app, opens assigned dated collections and records
   permitted payments. Assignment data must already exist; there is no assignment endpoint in
   this router.
5. Investigate missing collection work by checking tenant/shop, effective installment permissions,
   active assignments and **user-ID** linkage rather than profile ID.

## API contracts and data

Prefix `/api/v1/employees`; success/error envelopes, paginated list, 201 on create.

| Method and suffix | Contract |
|---|---|
| `GET /` | `page`, `pageSize`, optional search; active profiles for current primary/selected shop. Search designation, user full name or username. |
| `POST /` | Required UUID `userId`; optional nullable employment/contact fields. |
| `GET /:id` | Profile with selected user/shop data; uses `employees.list`, not a separate detail permission. |
| `PUT /:id` | Partial update; designation, joining date, salary, Aadhaar, address, emergency contact, `isActive`. |

[Validation](../../apps/api/src/modules/employees/employees.validation.ts): designation ≤100,
joining date `YYYY-MM-DD` regex, salary nonnegative, Aadhaar exactly 12 digits when provided,
emergency contact ≤15; date regex alone does not establish a real calendar date.
Money may be Decimal strings despite the web's local Employee interface typing salary as number.
No assignment, location, collection-history, attendance or payroll endpoints are present here.

## Web behavior

[Routes](../../apps/web/src/App.tsx) guard list/create/edit separately.
[Hooks](../../apps/web/src/hooks/useEmployees.ts) provide paginated list/detail and mutation
invalidation. List debounces search from two characters and links authorized edits.
Form loads detail for edit, fixes user linkage, and fetches `/users` for its dropdown.
That lookup can fail independently of `employees.create`; the form catches failures and leaves
an empty dropdown. It does not prefilter already-linked users, so backend 409 is the real check.
Blank optional form values become `undefined`, so clearing them is not equivalent to sending API
null. Salary `0` is also omitted by its truthiness conversion; the API itself accepts zero.

## Mobile behavior and differences

Existing [Expo login](../../apps/mobile/app/(auth)/login.tsx) presents an “Employee Collection App”
with shop selection; [collections hooks](../../apps/mobile/src/hooks/useCollections.ts) query
today/date collections, schedule details and payment API.
Legacy [payment form](../../apps/mobile/src/components/PaymentForm.tsx) offers cash, UPI,
credit/debit card and opt-in server preview penalty/deduction, not every API payment mode.
Its partial tab currently omits the displayed promise date and posts a plain payment; no promise
is saved by that path.

NEW Flutter is planned for all authorized tenant roles, not just employee collectors, with eventual
authorized web parity and staged releases. Proposed employee capability includes permitted profile
lookup/management alongside collection work, with user/profile/assignment distinctions preserved.
No Flutter implementation now. Offline collection writes, retry/idempotency, notifications,
location capture and background sync remain open; catalog permissions are not delivered features.

## Dependencies and cross-feature effects

- User accounts/roles and shop membership must exist independently of personnel profiles.
- [Installment](installment.md) owns `EmployeeCollectionAssignment`, payment attribution, promises
  and corrections. [Customers](customers.md) supplies contact data.
- [Shared permissions](../../packages/shared-types/src/permissions.ts) contain assignment,
  history and location keys, but those names alone establish no endpoint or workflow.
- All-role Flutter planning must not perpetuate role-name authorization assumptions or falsely
  promise every collection endpoint enforces assignment ownership.

## Code and source references

- API [routes](../../apps/api/src/modules/employees/employees.routes.ts),
  [controller](../../apps/api/src/modules/employees/employees.controller.ts),
  [service](../../apps/api/src/modules/employees/employees.service.ts),
  [validation](../../apps/api/src/modules/employees/employees.validation.ts),
  [registration](../../apps/api/src/app.ts), [schema](../../apps/api/prisma/schema.prisma).
- Collection [routes](../../apps/api/src/modules/installments/installments.routes.ts),
  [controller](../../apps/api/src/modules/installments/installments.controller.ts),
  [service](../../apps/api/src/modules/installments/installments.service.ts).
- Web list/form/hooks and Expo source linked above; [access tests](../../apps/api/tests/unit/access-rules.test.ts).

## Verification and acceptance

Source and documentation checks only; no API/database/browser/mobile tests executed.
Existing access-rule tests cover usable grants/collector versus sanitized-viewer differences,
not full personnel/assignment integration.
Acceptance cases:
- Missing user, duplicate profile, inactive-only list exclusion, nullable updates and salary zero.
- Feature off, missing edit/create grants, user deny, cross-tenant IDs and cross-shop target IDs.
- All-shops employee list's primary-shop fallback, without claiming aggregate behavior.
- Profile deactivation does not accidentally appear to disable login; role changes do not
  incorrectly imply profile reassignment.
- Employee-role dated collections ignore caller-supplied other employee ID, match active
  user-ID assignments and stay within permitted shops.
- Independently verify detail/payment/call-list assignment and target-shop enforcement rather
  than extrapolating from date-list behavior.
- Legacy partial-payment promise omission and `/users` lookup failure are visible recovery cases.

## Known gaps and next work

Confirmed: no assignment management API in this router; no profile privacy field filtering;
no aggregate employee list; target-shop comparisons absent for detail/update; web optional clears
and zero salary do not match API capabilities. Route/catalog distinction needs preserving.
Collection assignment filtering is endpoint-specific, not a complete authorization boundary.
Runtime collection provisioning, profile privacy and broader mobile parity require follow-up.

## Decisions and review checkpoint

Checkpoint **2026-11-10**, source-reviewed; API over comments/screens when they disagree.
Existing Expo is legacy; new Flutter is an all-authorized-role target with staged eventual parity.
No personnel model, access fix or mobile code was implemented in this documentation task.
Coordinator owns `docs/features/checkpoints.json`; do not infer fresh hashes from this prose.
