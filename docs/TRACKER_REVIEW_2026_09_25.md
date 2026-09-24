# September 25, 26 and 28 tracker review

Source: https://docs.google.com/spreadsheets/d/1uxMl8UJV-mgCxYnOFUtAhNjkyGchsvD8A3Apot9Xcos/edit?gid=0

S.No. 57 and 71–77 are excluded by request. The live sheet has not been marked complete. Source-level validation is not production acceptance.

| S.No. | Implementation / remaining verification |
| --- | --- |
| 7 | Employee lifecycle now exposes editable offer/appointment drafts, persistence and text download. HR must replace placeholders and approve terms before issuance. |
| 12, 24 | Bulk allocation now uses the existing calendar-day proration function; existing HR-adjusted balances are preserved. Historical allocations still require an audited reconciliation. |
| 17 | Existing report contains expandable daily punch times and CSV/Excel exports; added discoverability and timing guidance. |
| 20 | Existing tenant-scoped HR document listing includes employee profile documents; regression-tested. |
| 21 | Existing assignment/status controls retained; added category filter and export including comments/assignees. Category-based automatic ownership is not implemented. |
| 22 | Existing guest access and reaction flows retained; raised hands now also produce an onscreen notification. Multi-client device acceptance remains required. |
| 28 | Historical September 1 attendance has not been rewritten; requires affected employee/date records and authoritative punch evidence. |
| 32 | Added editable earning/deduction settlement breakdown with server-calculated totals, currency/date/notes and persisted draft; exit date/clearance flow retained. No automatic statutory calculation or payment is claimed. |
| 35 | AI holiday suggestions no longer create active holidays; inactive holidays excluded from list. Historical imported holidays still require management review. |
| 43 | Existing leave-approval routing regression-tested; no fabricated manager assignments. |
| 44 | Existing approval/rejection handling retained; affected account acceptance remains required. |
| 47 | Report explains company timezone, device sync and incomplete current-day data. No unconditional 24-hour delay is claimed. |
| 54 | Existing assets create permission and session-refresh behavior regression-tested; L2 alone does not grant access. Affected account permissions require verification. |
| 56, 67 | Existing authenticated private upload flow retained. Local environment lacks Blob credentials; production storage and authenticated upload acceptance remain unverified. |
| 58 | Added HR review-due list via actionable notifications; existing HR-to-manager approval workflow retained. Live notification acceptance remains required. |
| 62 | Added persisted optional PIP goals/review date to extension request, manager notification, lifecycle, and employee email on approval; delivery failure reported as warning. |
| 64 | Existing status-only helpdesk update fix regression-tested. |
| 66, 69 | Existing experience-letter upload and authenticated preview/download paths regression-tested; affected native-device acceptance remains required. |

## Release boundary

Desktop packages load the hosted web application; publishing installers does not itself deploy web changes. Windows signing credentials and Apple notarization remain separate prerequisites for a fully trusted release. User approved release with explicit signing warnings.

Full regression before final additions: 1,237 passed, 18 skipped, three failures in pre-existing source assertions (AI retry message, desktop chat launch, header animation attribute adjacency). Focused HR/lifecycle/document/release tests pass. Build configuration skips type checking and linting.
