# Mira desktop executor: Jev integration and release gate

Status: local implementation and component/integration validation, 2026-10-18.
Not a packaged-app acceptance certificate. Do not publish a release on the
strength of the automated fixture tests alone.

## Responsibilities

1. Native code opens explicitly named applications without an LLM.
2. DeepSeek makes one short, task-local navigation/input plan. It preserves user
   constraints, including not changing existing content while changing a view.
3. A fresh accessibility observation supplies current controls. A unique exact
   label is matched in code. Otherwise Jev chooses among filtered observed
   controls; it never invents a coordinate or operates the computer itself.
4. Native code checks consent, foreground identity, window geometry, reference
   freshness, control label/role, protected applications and action policy.
5. The existing Agent S/DeepSeek visual executor handles unsupported UI, uncertain
   targets and final completion verification. Its native-target action avoids
   approximate coordinates when a suitable observed control exists.

Jev is a structured text decision model, not a general screenshot-control model.
Its official guidance recommends narrow questions and independent evaluations:
[Introduction](https://docs.typesafe.ai/introduction),
[API](https://docs.typesafe.ai/api),
[Fan-out](https://docs.typesafe.ai/patterns/fan-out),
[Model limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13).
Dependent actions on future screens must remain sequential with fresh observations;
parallel model questions are not authorization to batch unknown UI actions.

## Local changes

- Include menu-bar items and focused pop-up menus in macOS observations. Prioritize
  actionable controls over static paragraphs in the bounded target list.
- Remove text fields from AXPress candidates; AX value filling remains separate.
- Return the first selection with the plan to save one authenticated round trip.
- Use human-readable control roles and one atomic Jev matching question. Keep the
  entire user task out of that decision request; DeepSeek retains the original goal.
- Keep confidence >= 0.85 and selected probability >= 0.90. Reject duplicate labels
  in code even when the model is confident. Do not lower thresholds to force actions.
- Refresh once for a settling/missing target or a proven-not-executed native input.
  Never replay uncertain input. Preserve bounded visual recovery and emergency stop.
- Keep only the current accessibility tree plus compact recent input/recovery notes
  in Agent S, instead of accumulating twelve stale full trees.
- Emit metadata-only `mira:desktop-diagnostic` events (stage, milliseconds, decision,
  retry/fallback). Never log goals, screenshots, field contents, tokens or plans.
- Preserve negative constraints after an explicit positive command (for example,
  changing Calculator mode without changing the calculation). Such constraints
  no longer discard the entire desktop request or require a chat-model round trip.
- Reset recovery budgets only on a new observation transition, not repeatedly
  against the screen before the last action. Unchanging screens cannot replenish
  the retry budget indefinitely.
- Check foreground/window identity, keyboard activity and observation expiry
  before accepting an Agent S completion. Stale completion triggers observation,
  not automatic replay of any previous input.

## Evidence and limits

Installed app baseline: opening Calculator worked. A compound switch-to-Scientific
request did not achieve the requested mode and changed the displayed calculation.
The task was stopped. This is a failed real-app acceptance case, not a passing test.
No messages were sent to third parties as part of these tests.

2026-10-18: a local arm64 test bundle built and opened the authenticated dashboard.
The app then showed its required-permissions checklist with Screen capture denied
(camera and microphone allowed). The user asked to defer Apple/permission setup;
no permission was granted or bypassed. Consequently this remains **blocked for
live desktop acceptance**, not a verified fix on the user's desktop. Apple account
setup and public release remain paused. The local bundle is not notarized.

Automated validation:

- 261 JavaScript tests across 12 focused suites passed.
- 15 Agent S Python tests passed.
- `swiftc -typecheck desktop-app/src/miraControl.swift` passed.
- Integrated simulated desktop tests use the real client, signed plan service,
  hybrid selector and native session guards. Provider responses and OS I/O are
  fixtures. They cover two-step menu navigation, fresh-reference retries,
  uncertain-effect stopping, provider fallback and press-without-progress.
- Opt-in real-provider tests use synthetic controls only and preserve Hindi input.
  They do not operate a desktop or prove task completion.

Observed final synthetic provider run:

| Component | Time | Outcome |
| --- | ---: | --- |
| DeepSeek initial plan | 769 ms | One search-field fill step |
| Exact label matching | <1 ms | No Jev request |
| Jev: Search notes | 467 ms | Correct target |
| Jev: Find a note | 311 ms | Correct target |
| Duplicate matching controls | Not benchmarked | Rejected |

Earlier prompts fell below confidence thresholds on the same alias task and
correctly fell back. Simplifying the question and translating AX role jargon
improved the measured result. These are small diagnostic samples, not a p50/p95
benchmark, SLA, or evidence of sub-250-ms full-task completion. A safe fallback
is not counted as a successful Jev selection in the printed live-test results.

## Reproduce without operating the user's desktop

```sh
npx jest tests/e2e/mira-desktop-pipeline.test.js tests/api/mira-hybrid-desktop.test.js tests/web/mira-hybrid-client.test.js tests/api/mira-computer.test.js --runInBand
desktop-app/build/agent-s-venv-darwin-arm64/bin/python -m unittest discover -s desktop-app/agent-s -p 'test_*.py'
swiftc -typecheck desktop-app/src/miraControl.swift
# Makes paid provider requests using local server credentials; synthetic data only:
MIRA_LIVE_DESKTOP_TESTS=1 npx jest tests/api/mira-hybrid-live.test.js --runInBand
```

## Required before release

Run the changed native helper and changed Agent S worker, not the old installed
binaries, in an isolated development session with valid OS permission. Record:

- App launch and restore, including an already-open app.
- A two-step menu/view change that preserves a known fixture value.
- English and Hindi search-field fill with read-back verification.
- A transient layout change, missing target and ambiguous target.
- Provider timeout/fallback and emergency cancellation mid-task.
- Existing browser/navigation and recipient-resolution workflows without sending
  a real message; external sends need an explicitly approved test recipient.
- Screenshot-grounded final state, elapsed task time and component diagnostics.

Only after those pass: package, sign and notarize; test an installed update and
permission continuity; then publish fresh release assets. Keep the Developer ID
identity and helper identifiers stable. Signing and permission setup are deferred
at the user's request; this control-only change does not remove release checks.
