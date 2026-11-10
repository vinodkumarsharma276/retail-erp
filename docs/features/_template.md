# Feature name

## Purpose and scope

Describe the user outcome and boundaries. Name the left-rail label(s) and route(s), or mark
this as a supporting capability. Link related feature documents instead of duplicating rules.

## Implementation status

| Surface | Status | Evidence / limits |
|---|---|---|
| API | Implemented / partial / absent | Link current source; do not infer completeness from a route existing. |
| Web | Implemented / partial / absent | Link screens and describe actual supported workflows. |
| Flutter | Planned / implemented / partial | Existing Expo code is legacy, not Flutter delivery. |

Documentation is source-reviewed, not runtime-certified unless verification below says otherwise.
State the review date and distinguish implemented behavior, approved plans, and open decisions.

## Business rules and invariants

Describe current rules, edge cases, money/date handling and destructive operations.
Separate current behavior from legacy/reference material.

## Access, tenancy, and shop scope

List permission keys, feature switches, field restrictions and actual API shop scope.
Audience "everyone" means all authorized tenant roles, never bypassing access checks.

## User workflows

Describe the principal success paths and meaningful error/recovery paths.

## API contracts and data

Summarize verified HTTP methods, prefixes, validation, response conventions and key models.
Link source files rather than copying the schema. Identify missing APIs as planned, not implemented.

## Web behavior

Describe screens, filters, forms, navigation and platform-specific behavior.

## Mobile behavior and differences

Flutter is the approved target, with eventual authorized web parity and staged releases.
Describe this feature's proposed mobile workflows; mark anything not yet decided as open.
Do not assume offline writes, notification delivery, or background sync already exists.

## Dependencies and cross-feature effects

Link relevant feature docs and shared rulebooks. List changes that require coordinated updates.

## Code and source references

Link the actual routes, services, validation, web screens/hooks, tests and relevant ADRs.
References should help the next agent find authoritative behavior without loading every file.

## Verification and acceptance

Distinguish source inspection from tests actually executed. Name existing tests or commands,
and list behavioral acceptance cases, including permissions and failure states.

## Known gaps and next work

Separate confirmed implementation gaps from unverified assumptions. Keep priorities here, not
in agent memory. Avoid claiming "complete" or "tested" without evidence.

## Decisions and review checkpoint

Record significant decisions and link ADRs for cross-cutting changes.
The machine-readable source inventory and hashes live in `docs/features/checkpoints.json`.
Refresh them only after inspecting changes and updating this document; a hash is not proof of
correctness, and a Git commit alone does not capture uncommitted changes.
