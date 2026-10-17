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
no permission was granted or bypassed at that point. The local bundle is not
notarized, and Apple account setup remains paused.

Later on 2026-10-18, the user explicitly authorized Screen Recording for the
rebuilt `desktop-app/dist/mac-arm64/Talio.app`. Adding it alongside the existing
entry did not fix access: Show in Finder still resolved the old `/Applications`
copy. Removing only the stale Screen Recording entry, re-adding the rebuilt
bundle and restarting cleared the app's required screen-capture setup gate.
The existing persistent-app quit interception also prevented macOS's first
Quit & Reopen attempt; the app was stopped through its existing explicit-quit
sequence and reopened. No application or user data was deleted.

The restarted dashboard initially reported **Accessibility — desktop controls
denied**. After explicit user authorization and the user's private macOS
authentication, the stale Accessibility entry was replaced with the rebuilt
bundle; the in-app permission warning cleared.

The subsequent real-app test opened Calculator successfully. The compound task
to switch to Scientific mode while preserving a disposable value of 42 failed
with the desktop-capture error; Calculator remained in Basic mode with 42 intact.
OS permission checks passed, but this did not prove a usable captured image.
Capture diagnostics now distinguish an unmatched display from an empty image,
with an unambiguous single-screen fallback for Electron's optional display ID.
Full desktop acceptance and public release remain blocked until this workflow
and the remaining cases below pass. No real messages were sent.

The next signed local build retained both grants without re-adding permissions.
Its compound Calculator test reached input execution but did not preserve 42;
the task reported no verified progress. Isolated View-menu and Scientific-menu
requests subsequently succeeded, verified against Calculator's native mode.
An additional native-boundary guard now rejects editing inputs, keyboard input
and approximate clicks when the original user goal explicitly requires content
preservation. It allows fresh native menu/toolbar navigation targets; this is
enforced independently of the planner. Metadata-only native diagnostics contain
action types/roles, outcomes, target counts and durations, not typed text, goals,
UI labels, screenshots or credentials.

The preservation guard kept 42 intact on the following two compound attempts,
but the workflow still stalled. UI inspection then showed Talio's View menu
selected while Calculator was unchanged. The persistent Swift helper was using
`NSWorkspace.frontmostApplication` while blocked in a `readLine()` loop. Its
notification-backed snapshot could stay on the app from before activation;
observations and their foreground guards therefore agreed on the wrong app.
The helper now drains workspace notifications and obtains the focused application's
PID from the live system-wide Accessibility object on every command. On systems
where that attribute is absent, it uses the notification-refreshed workspace
instead of its stale cached value. Missing focus fails closed. Apple documents
the Accessibility attribute as identifying the application
currently accepting keyboard input:
[kAXFocusedApplicationAttribute](https://developer.apple.com/documentation/applicationservices/kaxfocusedapplicationattribute).

Visual navigation clicks are also resolved to a unique safe native control when
strictly inside its current bounds. Overlaps, edge hits and destructive controls
are not converted; native reference/foreground/geometry checks still apply.
The signed build with this foreground fix successfully switched Calculator from
Basic to Scientific while preserving 42. Native menu actions took 22 ms and 15 ms;
these are input timings, not end-to-end task latency. Final verification still
failed because Electron returned an empty thumbnail despite permission being
granted. A ScreenCaptureKit fallback now requests only the exact current display,
uses the existing TCC grant, bounds image size/time, keeps images in memory, and
retains the post-capture foreground/window check.

The next signed packaged build completed both real compound tasks: Hindi
Scientific-to-Basic and English Basic-to-Scientific, preserving 42 and returning
accurate completion messages. The observed native task intervals were about
25 and 28 seconds, respectively; these are single-run samples, not latency SLAs.
Electron capture succeeded in these runs, so the ScreenCaptureKit fallback is
unit-tested and compiled but has not yet been exercised by a live empty-image
failure. Both OS permissions remained granted after rebuilding/restarting.

A new-unsaved-document test exposed an overly broad preservation clause: the
restriction on editing existing documents blocked even the requested new one.
The task was stopped with the emergency shortcut. The view-only input guard now
distinguishes that specifically scoped clause when creating a new document;
the full original constraint still goes to the planner. Current-document/value
constraints and Hinglish preservation requests retain the native guard.

The next TextEdit run activated the intended app, but focus then moved to ChatGPT
while planning. The old retry path treated the new foreground as a new planning
surface and subsequently opened App Store. The test was stopped before typing.
An application-PID change between observation and input now ends the task with
no input, rather than allowing retries to chase an unrelated app. Same-app
window-layout changes still re-observe safely. This is regression-tested; the
new-document workflow was then repeated in an uninterrupted run.

The final signed build created a new Untitled TextEdit document and entered
`Mira control test — नमस्ते दुनिया`, independently read back through native AX.
The app gave an accurate completion response. No explicit save or send occurred;
the disposable document remains open. Electron again returned an empty image,
and the ScreenCaptureKit fallback successfully supplied the verification image
in 215 ms. This is live evidence of the fallback, superseding its earlier
unit-test-only status. Broader missing/ambiguous-target and installed-update
acceptance cases below remain required before public release.

Automated validation:

- 285 JavaScript tests across 13 focused suites passed.
- 53 permission, startup, signing-policy and update-UI tests passed separately.
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
