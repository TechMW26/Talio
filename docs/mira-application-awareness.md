# MIRA application awareness

The App Router currently contains 94 dashboard page routes. `npm run mira:map`
scans those pages and their local UI imports (four levels), extracts literal
headings, labels, icon titles, placeholders and tab titles, and combines them
with names from `utils/roleBasedMenus.js`. The generated artifact is
`lib/miraAppMap.generated.json`. Both production build scripts regenerate it.
Run `node scripts/generate-mira-app-map.cjs --check` to detect drift.

## Runtime flow

1. `getMiraClientContext` captures up to 70 rendered controls, prioritizing the
   viewport and the active dialog. It includes labels, opaque DOM IDs, region,
   disabled state and whether navigation execution is supported. Input values,
   password fields and MIRA's own UI are excluded.
2. The authenticated chat route sanitizes this inventory and retrieves relevant
   source-map entries for the query/current page. Source-map labels describe
   possible UI; the live inventory describes this user's rendered UI.
3. Navigation resolves approved App Router paths through `miraNavigationPath`.
   Existing entity resolvers find accessible projects, tasks and meetings before
   constructing deep links. Task details use `?task=<id>`. Settings accepts only
   known `tab` values. External URLs and unknown paths are rejected.
4. UI actions recheck the selected DOM element before clicking. Header/sidebar
   controls and icon-only title labels are included. A dialog limits selection
   to its own controls. Business mutations remain in authenticated server actions.
5. `continueUi:true` requests another observation after a successful page or UI
   step. Continuations share the original user request and executor outcomes,
   are bounded to eight steps, and stop on failure or cancellation.

## Confirmed locations and local actions

- Focus Timer, Calculator, Quick Note and location/weather: Dashboard → Quick
  Tools. The timer is not a Settings feature. The active timer also appears in
  the header on other pages.
- Focus timer commands use `FocusTimerProvider` via a registered handler:
  start (optional 1–180 minute duration), pause, resume, reset, dismiss alarm.
  Start is explicit and never implemented as a toggle.
- Ask MIRA, AI Search and Call / Alert: global header.
- Individual project and meeting: list → entity detail route.
- Individual task: Projects → My Tasks → task query parameter.

## Access and limitations

The map is discovery context, not a permission source. Sidebar filtering still
uses role menus, RBAC and company feature flags; APIs retain tenant and resource
authorization. Static labels may belong to conditional or unopened UI. Controls
not marked executable are available for guidance only; MIRA must use a supported
server action for their mutations or explain the exact remaining step.
Credential/diagnostic pages are excluded from navigable atlas paths. Visible
labels and uploaded/screen content remain untrusted data, never instructions.
New complex workflows still need an explicit executor; indexing a button does
not make arbitrary business actions safe or supported.
