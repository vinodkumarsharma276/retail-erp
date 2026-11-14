# Settings

## Purpose and scope

The tenant left-rail **Settings** entry opens `/settings`. Its actual nested tabs are
**Form Builder** (`/settings/forms`), **Category Manager** (`/settings/categories`), and
**Roles & Users** (`/settings/roles`), whose inner tabs are **Roles** and **Users**.
There is no general app-settings or shop-editor tab in this screen.
Personal `/preferences` is a separate authenticated screen, not a Settings tab.
See [authentication and access](authentication-and-access.md) for session and permission
resolution and [platform administration](platform-administration.md) for subscription controls.

## Implementation status

| Surface | Status | Evidence / limits |
|---|---|---|
| API | Implemented, with gaps | Forms, category/attribute, role/override, user and shop APIs exist; route guards and scope differ below. |
| Web | Implemented, partial API coverage | Three Settings tabs; nested role/user management. No user-create, user-deactivate or shop-details editor in these tabs. |
| Flutter | Planned | Approved new target for all authorized tenant roles, with eventual authorized web parity; existing Expo is legacy, not Flutter delivery. |

Reviewed **2026-11-10** against source, not runtime-certified. The API is the contract
authority; a visible control or permission-catalog entry is not proof of API support.

## Business rules and invariants

- Form definitions have a name, optional shop, description, active state and version.
  The name-lookup controller uses query `shopId` or, if absent, the JWT shop (not the
  selected-shop header). Lookup chooses the newest active shop-specific definition,
  otherwise falls back to the newest tenant-wide definition (`shopId = null`).
  Runtime name lookup returns visible fields only; the management-by-ID view includes hidden fields.
- Fields carry name, label, type, placeholder, default, required/visible flags, section,
  CSS class, validation JSON, options JSON, dependency JSON and display order. Supported API
  types are text, number, select, multi-select, date, tel, email, textarea, checkbox,
  radio, file and hidden. A field-type option is not a new binary-upload service.
  New fields append after the current maximum order. Reordering checks that submitted IDs
  belong to the definition; it does not require the array to be a complete permutation.
  Field deletion is physical, unlike category/attribute deactivation.
- Categories form a tenant-wide tree with parent, slug, level/path, leaf flag, icon,
  HSN, order and purchase mode (`billed`, `unbilled`, `both`; default `billed`).
  Service duplicate checks include inactive sibling categories and normalized name/slug
  clashes. Category deletion is soft and refuses categories containing products or active
  children. Attribute deletion marks it inactive; attribute reads select the category's
  own active attributes, not inherited ancestor attributes.
- System roles cannot be deleted; custom roles assigned to any user cannot be deleted.
  Cloning copies grants into a new non-system role. Saving role permissions replaces the set.
  Per-user overrides replace all grants/denies; omitted keys revert to inheritance.
  A key in both arrays is rejected; unknown catalog keys are ignored.
- Password reset accepts an override of at least four characters or generates a password,
  returns the new plaintext once in the response and revokes refresh tokens. User
  deactivation also revokes refresh tokens; this is not immediate access-JWT revocation.

## Access, tenancy, and shop scope

- The rail uses `nav.settings`; the parent page requires `settings.view`. Child guards require
  `forms.view`, `categories.list`, or either `roles.list` / `users.list`, respectively.
  Write controls are not substitutes for API guards.
- Forms writes are gated by `dynamic_forms`; roles-module writes, including its user-role,
  password-reset and override endpoints, are gated by `custom_roles`. Their reads stay
  available when those switches are off. `/users`, `/shops`, `/categories` and `/lookup`
  are not registered behind those module gates.
- These management routes do **not** run `shopScope`. Prisma supplies tenant filtering,
  not selected-shop filtering: role/user lists, category trees and definition lists are
  tenant-wide. An optional form `shopId` is configuration selection, not an assignment check.
- Shop list requires `shops.list` or `shop.switch`, but lists the tenant's shops, not only
  the caller's assignments. Shop-by-ID needs authentication: owner/admin legacy role names
  select the full projection; other callers get invoice-oriented public fields without
  bank/user-assignment data. Independently, response field filtering requires
  `shops.view_bank_details` for bank fields.
- `limits.max_shops` / `limits.max_users` exist in the feature catalog; these reviewed
  management services do not enforce numeric capacity limits. Do not promise plan caps.

## User workflows

1. Open Settings; `/settings` redirects to the first visible tab in forms/categories/roles
   order. With no visible child, the fallback is `/settings/forms`, whose guard may deny it.
2. Select a form, add a field, edit its label/type/rules/options/dependency, move it up/down,
   or confirm deletion. Creating a definition takes a lowercase underscore-style name and
   optional description; the web create flow does not expose the API's shop-specific option.
3. Expand the category tree, add a root or child, then select a category to edit details or
   manage attributes. Resolve duplicate-name errors rather than creating near-duplicates.
   The API supports category soft deletion; this page exposes attribute deletion, not a
   category-delete workflow.
4. In Roles, select/create/clone a role, search/group its grants, save or discard the draft.
   Checking a grant adds prerequisites; unchecking removes dependents. Delete only an unused
   custom role. API failures remain authoritative even when a UI group is editable.
5. In Users, search users, assign a role, edit allowed shops, reset a password, or open
   overrides. Choose inherit/allow/deny and save the complete override set. Shop assignment
   requires at least one UUID; the first submitted shop becomes primary.

## API contracts and data

All paths below start `/api/v1`; all require tenant authentication unless explicitly noted.
Controllers generally return `{ success, data }`; `/users` list is paginated.

| Path / methods | Additional guard / data |
|---|---|
| `/forms/definitions` GET / POST | `forms.view` / `forms.edit_definitions`; POST `{ formName, description?, shopId? }`. |
| `/forms/definitions/:formName` GET | Authentication only; optional query `shopId`. |
| `/forms/definitions/id/:id` GET | `forms.view`. |
| `/forms/definitions/:id` PUT | `forms.edit_definitions`; name, description, active state. |
| `/forms/definitions/:id/fields` GET / POST | Authentication only / `forms.add_field`. |
| `/forms/fields/:id` PUT / DELETE | `forms.edit_definitions` / `forms.delete_field`. |
| `/forms/definitions/:id/fields/reorder` PUT | `forms.edit_definitions`; nonempty `{ fieldIds: UUID[] }`. |
| `/categories` GET; `/categories/:id` GET | Authentication only, unlike the web `categories.list` page guard. |
| `/categories` POST; `/categories/:id` PUT / DELETE | `categories.create` / `categories.edit` / `categories.delete`. |
| `/categories/:id/attributes` GET / POST | Authentication only / `categories.edit_attributes`. |
| `/categories/:id/attributes/:attrId` PUT / DELETE | `categories.edit_attributes`. |
| `/roles/permissions/catalog` GET | Either `roles.list` or `users.list`; grouped catalog. |
| `/roles` GET / POST; `/roles/:id` GET / PUT / DELETE | `roles.list` / `roles.create`; then `roles.list` / `roles.edit_permissions` / `roles.delete`. |
| `/roles/:id/permissions` PUT; `/roles/:id/clone` POST | `roles.edit_permissions`, `{ permissions }`; `roles.create`, `{ code, name }`. |
| `/roles/users` GET | `users.list`; includes role, shops, active/mobile state, last login and known-seed-password indicator. |
| `/roles/users/:userId/role` PUT | `users.change_role`; `{ roleId: UUID or null }`. |
| `/roles/users/:userId/reset-password` POST | `users.reset_password`; optional `{ password }`; returns `{ newPassword }`. |
| `/roles/users/:userId/permissions` GET / PUT | `users.edit_permissions`; baseline/grants/denies/raw effective set; PUT `{ grants, denies }`. |
| `/users` GET / POST; `/users/:id` GET / PUT / DELETE | `users.list` / `users.create`; then `users.list` / `users.edit` / `users.deactivate`. DELETE deactivates. |
| `/users/:id/assign-shops` PUT | `users.assign_to_shops`; nonempty `{ shopIds: UUID[] }`. |
| `/shops` GET; `/shops/:id` GET / PUT | Either `shops.list` or `shop.switch`; then authentication only / `shops.edit`. No shop-create route here. |
| `/lookup/cities?q=...` GET | Authentication only; tenant-wide customer/distributor cities, substring case-insensitive query, trimmed/deduplicated/sorted, up to 500 rows per source. |
| `/lookup/brands?categoryId=...` GET | Authentication only; category brand options plus used product brands, case-insensitive deduplication (configured spelling wins), sorted; missing category returns `[]`. |

Form names allow lowercase letters/digits/underscores (100 chars); field names allow
letters/digits/underscores (100), labels 200. Category slugs use lowercase hyphenated
segments; HSN length is at most eight. Attribute names use lowercase underscores.
JSON options/rules/dependencies are permissive `z.any()`, not deeply schema-certified.

User creation takes username (3–100), password (minimum six), name, optional email,
phone, legacy role (`admin`, `accountant`, `others`, `employee`), mobile-only flag and
nonempty shop IDs; it does not accept `owner` or directly bind `roleId`.
Shop update supports name, GST/PAN, address/city/state/pincode, phone/email,
bank name/account/IFSC/branch, logo URL and active flag, not shop code.

## Web behavior

Form Builder has a definition sidebar and expandable field editor with type badges,
required/hidden markers, options editor, regex/min/max/length rules and field/value
dependency controls. Category Manager has a recursive tree, root/child creation,
detail editing and inline attribute add/edit/delete; its attribute-type menu is narrower
than the API enum. Category detail editing exposes name, icon and HSN.

Roles has search, group expansion, granted-only filtering and unsaved draft state.
Users has role selectors, shop-access and override dialogs and password reveal/reset
dialogs. Known default-password reveal is hidden unless the viewer can reset passwords;
the `/roles/users` service itself calculates and returns the indicator under `users.list`.
Neither arbitrary password hashes nor arbitrary current passwords are returned.

Some panels use a broad “any write permission” fieldset, so individual actions can remain
clickable without their exact grant and receive API 403. The Users panel also fetches the
role list: a `users.list`-only caller can enter the page but that query still needs `roles.list`.
`settings.app_settings` and `categories.edit_hsn_code` catalog keys do not create extra
routes/tabs; HSN updates use the category-edit endpoint guard.

## Mobile behavior and differences

New Flutter releases should stage authorized settings readers before destructive editors,
then provide form/category management and role/user administration for users with the
same API grants. “All roles” means all authorized tenant roles, not universal admin access.
Existing employee-only Expo screens are legacy and are not this delivery; no deletion or
app implementation is implied. Responsive editing, confirmation UX and secure password
handoff need design. Offline configuration writes and background synchronization are not
implemented or approved assumptions.

## Dependencies and cross-feature effects

Form/category edits affect product/customer/distributor/sale form consumers and category
brand suggestions. Purchase mode affects billed/unbilled category selection.
Role changes affect rail visibility, page/action/field access and shop switching:
see [authentication and access](authentication-and-access.md).
Plan/override changes come from [platform administration](platform-administration.md).
Personal notification preferences are not delivery setup; see [notifications](notifications.md).

## Code and source references

- Web: [router](../../apps/web/src/App.tsx), [Settings](../../apps/web/src/pages/settings/SettingsPage.tsx),
  [Form Builder](../../apps/web/src/pages/settings/FormBuilderPage.tsx),
  [Category Manager](../../apps/web/src/pages/settings/CategoryManagerPage.tsx),
  [Roles & Users](../../apps/web/src/pages/settings/RolesUsersPage.tsx),
  [role API client](../../apps/web/src/api/roles-api.ts).
- Forms: [routes](../../apps/api/src/modules/forms/forms.routes.ts),
  [controller](../../apps/api/src/modules/forms/forms.controller.ts),
  [service](../../apps/api/src/modules/forms/forms.service.ts),
  [validation](../../apps/api/src/modules/forms/forms.validation.ts).
- Categories: [routes](../../apps/api/src/modules/categories/categories.routes.ts),
  [service](../../apps/api/src/modules/categories/categories.service.ts),
  [validation](../../apps/api/src/modules/categories/categories.validation.ts);
  [lookups](../../apps/api/src/modules/lookup/lookup.routes.ts).
- Roles: [routes](../../apps/api/src/modules/roles/roles.routes.ts),
  [controller](../../apps/api/src/modules/roles/roles.controller.ts),
  [service](../../apps/api/src/modules/roles/roles.service.ts).
- Users: [routes](../../apps/api/src/modules/users/users.routes.ts),
  [service](../../apps/api/src/modules/users/users.service.ts),
  [validation](../../apps/api/src/modules/users/users.validation.ts).
- Shops: [routes](../../apps/api/src/modules/shops/shops.routes.ts),
  [controller](../../apps/api/src/modules/shops/shops.controller.ts),
  [service](../../apps/api/src/modules/shops/shops.service.ts),
  [validation](../../apps/api/src/modules/shops/shops.validation.ts).
- Shared [permissions](../../packages/shared-types/src/permissions.ts),
  [access prerequisites](../../packages/shared-types/src/access.ts),
  [feature registration](../../apps/api/src/app.ts).

## Verification and acceptance

Source inspection only; no runtime, test suite, install or application change performed.
Existing related tests: [category normalization unit tests](../../apps/api/tests/unit/category-duplicates.test.ts),
[category integration tests](../../apps/api/tests/integration/category-duplicates.test.ts),
[access rules](../../apps/api/tests/unit/access-rules.test.ts) and
[tenant isolation](../../apps/api/tests/integration/tenant-isolation.test.ts).
These are references, not claims that they ran in this review.

Acceptance cases for a later verification:

- A reader opens the correct default child; removing each child grant hides/blocks it.
- Disable `dynamic_forms`: rendering reads still work, while every form mutation returns 403.
- Create shop-specific and tenant-wide definitions; resolve the correct version and
  visible fields. Reject foreign-definition reorder IDs; confirm deletion is permanent.
- Reject normalized sibling duplicates and deletion of categories with products/children;
  attribute deactivation removes it from active reads.
- Saving a role/override changes API authorization on the next uncached request and web
  state after `/auth/me`; deny beats role grants and disabled features still win.
- Reject deletion of system/assigned roles, empty shop assignments and conflicting overrides.
- Test two tenants with similarly named users/categories; selected-shop changes must not
  be mistaken for isolation of tenant-wide management lists.
- Test reset/deactivation, remaining access-token lifetime, and the difference between
  four-character administrative reset and six-character self-service password validation.

## Known gaps and next work

The legacy `/users` create/update role enum is separate from permission-bearing `roleId`;
do not assume creating/updating that enum provisions effective grants. Roles endpoints
lack route-level Zod body schemas. Shop-assignment IDs have UUID validation but the reviewed
service does not explicitly validate every referenced shop's tenant/active state.
Replacing shop assignments deletes old rows before inserting new ones without a shared
transaction; a failed replacement must not be assumed to preserve prior assignments.
Review these paths before promising robust provisioning or hostile-input certification.
Capacity enforcement, shop creation, a full user lifecycle UI and fine-grained button guards
are not supplied by these Settings tabs.

## Decisions and review checkpoint

2026-11-14 (type cleanup for CI, [deployment and release](deployment-and-release.md)): user
creation checked duplicate usernames with `findUnique` on `username`, which is unique only per
tenant (Prisma rejected the call); it now uses the tenant-filtered `findFirst`. The user and its
nested shop assignments get `tenantId` explicitly, because the scoped client stamps only top-level
creates. Role/permission `createMany` edits were type-only.

2026-11-10: Settings is the only tenant-rail capability documented here; supporting auth,
notifications and platform administration remain separate documents. Flutter is the approved
new all-authorized-role target; Expo remains legacy unchanged. Source review is not runtime
certification. Machine inventory/hashes belong in `docs/features/checkpoints.json`; that
file is intentionally not created or edited by this documentation-only task.
