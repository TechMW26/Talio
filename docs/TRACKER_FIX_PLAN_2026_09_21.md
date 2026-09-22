# Talio tracker action plan — 21 September 2026

Source: https://docs.google.com/spreadsheets/d/1uxMl8UJV-mgCxYnOFUtAhNjkyGchsvD8A3Apot9Xcos/edit?gid=0

Scope uses the **S.No. column**, not worksheet row numbers. S.No. **71–77 are excluded**, as confirmed by the requester. The live sheet is not modified by this implementation.

## Execution order

| Stage | S.No. | Work and acceptance criteria |
| --- | --- | --- |
| 1. Access and employee records | 1, 2, 5, 6, 9, 20, 31, 54, 55, 60, 66–70 | Preserve tenant isolation; use configured module/action permissions; support direct reporting without a TL; ensure HR can upload/view employee documents; make edit/view controls accessible; keep history attached to immutable employee IDs. |
| 2. Attendance and leave | 3, 8, 12, 13, 17, 24, 28, 35, 43, 44, 47, 49 | Inspect device punches and report timestamps; pro-rate new allocations without destroying HR adjustments; support backdated requests through approval; company-approved holiday source only; retain server validation, geofencing and reject actions. Do not alter historical employee records without reconciliation evidence. |
| 3. Helpdesk and assets | 21, 54, 60, 64, 65 | Fix status-save error; validate updates and routing; notify assigned employees; enforce configured asset permissions on both client and API; keep full asset details visible. |
| 4. Recruitment and probation | 7, 56, 57, 58, 62 | Make existing offer generation discoverable; fix CV upload; distinguish source labels from authenticated provider integrations; HR initiates manager review, with persisted remarks and PIP/email flow. TalentLens/career-page development remains excluded. |
| 5. Meetings and live data | 22, 52, 53 | Verify guest access/reactions, message toast and unread badge; revalidate affected data on tenant-scoped events without reloading forms or media. |
| 6. Regression and acceptance | All included items | Run focused tests, full regression suite, production build and source/diff checks. Report code-tested, live-tested and externally blocked items separately. |

## Already marked completed in the sheet

S.No. 4, 6, 11, 15, 16, 23, 25–27, 29, 30, 32–34, 36–42, 45, 46, 48, 50, 51, 59 and 63 need regression checks, not blanket rewrites. Remarks take precedence over completion checkboxes when they describe an unresolved defect. S.No. 33 still requires HR feedback about MIRA usefulness.

## UI and data-flow constraints

- Existing list → search/filter → visible view/edit/upload action → modal with pending/error/saved states.
- Employee hierarchy → manager selection → optional TL → validated reporting relationship; no fabricated manager.
- Document list → preview with persistent close/back controls → download fallback for unsupported formats.
- Request → authenticated tenant API → validation/authorization → persisted record → notification and targeted cache invalidation. Never reload the entire dashboard to simulate realtime updates.
- Keep tenant/module feature gates; designation levels must not implicitly grant administrative access.

## Dependencies and release gates

- Requester delegated the pro-rata choice: use calendar-day allocation, inclusive of joining day and leap-year aware, rounded to two decimals. Preserve existing balances and HR adjustments; historical reconciliation requires a separate audit.
- Job portal connections require the selected provider's supported API and organization credentials; labels alone are not an integration.
- Device-specific crashes and historical attendance discrepancies require reproducible evidence; never fabricate corrected punches.
- Aadhaar verification must not claim authoritative identity verification from an image/OCR result alone.
- Do not mark all rows complete based on unit tests or compilation alone.

## Implementation evidence

### Implemented locally in this batch

| S.No. | Change | Validation and remaining boundary |
| --- | --- | --- |
| 12, 24 | New leave balances use inclusive calendar-day proration. Missing personal balances are allocated on fetch; existing adjusted balances and usage are preserved. | Leap-year, joining-day, future-year and insert-only tests. Existing full-year allocations are not silently rewritten; historical reconciliation remains pending. |
| 13 | Removed the frontend ban on backdated normal leave and WFH requests. Early-leave requests retain their current-date restriction. | Build and regression checks; real approval flow still needs HR acceptance. |
| 20 | HR's aggregate document list includes profile Aadhaar uploads. Self-service queries enforce employee ownership across both document stores. | Tests cover HR aggregation, self access, cross-employee denial and category filtering. Live private-file delivery still needs configured storage. |
| 30 | Aggregate leave balances exclude departed employees; self balance lookup uses employee identity instead of user identity. | Route tests cover access isolation and active/probation filtering. No employee history was deleted. |
| 54, 60 | Asset create/edit/import honors configured role permissions; client controls refresh on session permission events without page reload. | Permission-hook and create-route tests. No automatic privileges are granted merely for designation level L2. |
| 64 | Helpdesk PUT/PATCH share validated updates, removing the undefined attachment variable; invalid assignees and protected fields are rejected. | Status-only PUT/PATCH, malformed input, cross-tenant assignee and sanitizer tests. UI only sends an assignee when changed, including unassignment. |
| 65 | New assignments, reassignment and assigned bulk imports schedule notifications after saving. Unchanged assignments do not notify again. | Notification tests cover first assignment, reassignment, unchanged assignment and unassignment. Live delivery remains unverified. |
| 66, 69 | Added experience-letter upload category; document modal fetches authenticated files with loading/error/retry states and authenticated download, retaining close controls. | File-loader tests ensure tokens never reach external hosts and reject HTML/error responses. Desktop PDF rendering needs device acceptance; upload requires storage. |
| 68, 70 | Employee view/edit actions remain visible during horizontal table scrolling. | Production compilation; needs visual acceptance on the affected HR screen. |

### 22 September — hierarchy implementation

- S.No. 1–2: organogram parent selection now honors the saved direct reporting manager, falling back to team lead, assigned manager and executive escalation only for legacy records without that field. Department membership alone no longer fabricates a reporting line.
- Employee creation/update shares the same reporting helper. Removing a team lead re-derives the direct manager from retained assignments; clearing all assignments clears stale workflow routing. Unrelated edits leave reporting untouched.
- Add/edit forms explicitly label team lead as optional. Creation no longer requires executive escalation when a manager or team lead is selected.
- Removed an unused team query from the organogram endpoint. Existing cycle protection retains employees whose links are cyclic, self-referencing or missing.
- Added helper and route regression tests for direct reporting, partial clears, unrelated edits, missing managers and cycles. No existing production hierarchy was migrated or overwritten; affected employee records still need HR review where historical assignments are wrong.
- Validation: production build passed (259 static pages; configured type/lint checks remain skipped). Full regression passed 680 tests with 18 skipped, followed by an additional employee-update API regression test. Browser acceptance and release are pending.

### Remaining acceptance and dependencies

- Other tracker issues are not claimed fixed by this batch: hierarchy behavior, biometric punch visibility, historical attendance discrepancies, approved-holiday reconciliation, probation workflow acceptance, recruitment/source setup, guest/reaction behavior and realtime acceptance.
- The live deployment was checked during this task and reported `blobStorage: false`; the linked project had no Blob store. Private-store setup approval is pending. Do not use public storage for employee documents.
- Final full regression: 112 suites passed, 1 skipped; 669 tests passed, 18 skipped (37 new passing tests). Production build passed and generated 259 static pages. The project build explicitly skips type validation and linting; it is not evidence that those checks passed. `git diff --check` passed. Browser/device acceptance is still pending.
- No production employee records were changed, no live tracker rows were marked complete, and this batch has not been pushed or deployed.
