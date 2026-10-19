# Mira desktop executor: validation history

Current implementation: the pre-Jev visual controller is restored as described
in the 2026-10-19 entry below. Earlier Jev integration notes are historical, not
the current execution path.

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

### Installed-app routing follow-up — 2026-10-18

The reported YouTube Music fallback had a concrete native lookup gap: the app is
installed inside `~/Applications/Chrome Apps.localized`, while the old launcher
only inspected the top level of Applications folders. The Mac resolver now
searches bounded application subfolders and bundle display names, without
descending into app bundles or symlinks. Multiple matching apps require a choice.
YouTube Music has a deterministic native-launch route; compound tasks continue
planning after launch and do not claim that playback has started.

Both fast and planned native lookup misses now request OS app search before a
browser fallback. Shared planner instructions cover Spotlight, Windows Start
search and supported Linux launchers, require inspection of application results,
and preserve explicit browser/website requests. The hybrid planner must defer
cross-app activation to the native launcher rather than planning a browser
substitute. This is not an installed-app inventory upload.

Validation: 1,034 regression tests passed, 19 optional tests skipped; Swift
type-check and the production web build passed. Seven compiled native lookup
fixture assertions passed. A read-only lookup found the actual installed
YouTube Music bundle in 140 ms (one sample, not whole-task latency). Reproduce
without launching any app:

```sh
node desktop-app/scripts/test-mira-app-lookup.cjs 'YouTube Music'
```

Live macOS acceptance: the final arm64 6.0.31 build was repackaged and Developer
ID signature verification passed for the application and both control helpers.
Packaged routing files were byte-compared with source. Through the rebuilt
Talio chat UI, `Open YouTube Music` launched the installed Chrome app bundle
`com.google.Chrome.app.cinhimbnkkaeohfgghhklpknlkffjgod`. Its native window and
music search field were observed, with the player paused at 0:00. Safari was
not running in the post-launch application inventory. No playback was requested
or started during this launch-only test. Notarization remains unavailable.

Windows/Linux native app launch behavior and GUI search fallback still require
hands-on acceptance on those platforms.

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

## Pre-Jev visual controller restored — 2026-10-19

At the owner's request, the control flow is restored from `cff26d3c` (6.0.28),
the parent of the Jev integration commit `2674cb55`. The client, executor,
Agent S action interface/worker and model relay use the earlier visual loop:
observe screenshot, request an Agent S/DeepSeek action, execute a guarded native
input, observe again, verify completion. Native calls use the earlier per-command
process instead of the Jev-era persistent transport. The Jev provider, plan cache,
semantic selector and their provider-specific tests are removed, recoverable in
Git. No TypeSafe/Jev network call remains in the active application source.

The authenticated `/api/ai/mira-desktop-plan` compatibility endpoint returns
`fallback: true` without contacting any provider, so cached older web clients
fall back to visual planning. Credentials are not printed, changed or revoked.

This is a targeted control rollback, not a repository reset. Camera, voice,
PiP position, updater UI and Developer ID signing are retained. Later native
focus/Unicode fixes, exact-display capture recovery and installed-app lookup are
retained, as are stop-on-uncertain-input and foreground-change guards. Repeated
system policy duplication is not restored. New simulated integration tests
exercise multi-step screenshot planning, fresh-observation recovery, uncertain
input stopping and no-progress stopping without any Jev calls. These are not
live-device acceptance or evidence that the public release has been replaced.

## Visual batching, rendering and personal defaults — 2026-10-19

The subsequent performance work stays on the restored visual controller, with
no Jev calls. Both the Python action interface and privileged JavaScript boundary
accept bounded four-input Find/edit/close and browser-address sequences. One
screenshot grounds a batch; native foreground/window/consent/cancellation checks
still run before each input. Navigation, app changes and uncertain state require
a new screenshot. Sends and submissions are not blindly batched or replayed.

Idle hidden dashboard renderers now throttle. Voice, chat, native desktop work
and playing media acquire independent activity exemptions, cleared on navigation,
crash or completion; desktop/request exemptions have a bounded lease. Chromium
keeps its normal GPU/driver fallback. Recurring guardian heartbeat writes are
asynchronous. Mira faces retain their 30fps clock and expressions, skip offscreen
raster work, use their actual owner window's DPR capped at 1.5, and memoize parent
renders. This reduces rendering work; it is not a measured all-platform FPS claim.

Desktop model proposals have a 60-second, 100-entry process-local cache keyed by
tenant, account, model, full validated history/policy and exact screenshot hash.
It stores no screenshots. Recoveries bypass it; native guards still validate every
hit. Completion, arbitrary clicks, sends and externally visible submission results
are not cached. A separate 150-entry, five-minute answer cache only admits bounded
timeless text queries and action-free JSON responses, with account, language,
personal context and model in its key. Live facts, screen/camera and tool outcomes
bypass answer caching. These are opportunistic caches, not durable workflow replay
or guaranteed hits across server instances.

The first habit-learning scope is music: successful explicit Mira requests to
YouTube Music, Spotify or Apple Music, and named songs. Nothing passively monitors
other app usage. Defaults require repeated evidence, never override an explicit
choice, and inferred choices do not reinforce their own counts. Bounded preferences
live on the authenticated user's tenant-local profile, expire after 90 days and
can be disabled/cleared in Mira Settings. Completion receipts bind the original
request to that account, expire after 15 minutes and are deduplicated; clearing or
disabling invalidates outstanding receipts. These receipts authenticate the request,
not independent server-side proof of desktop execution. The client reports success
only after the existing native/visual completion path.

Validation: 1,039 JavaScript tests passed, 18 optional tests skipped; 12 Python
tests passed. Production web build and packaged Agent S startup/prediction/
continuity/restart checks passed. Simulated tests prove four inputs use one
screenshot, retries bypass caches, accounts cannot reuse each other's receipts or
cache entries, partial batches stop, and preference deletion survives late results.
Real desktop task and FPS acceptance on macOS, Windows and Linux remains separate
from these fixture checks. No new GitHub release or production deployment is
implied by this local validation.

Local arm64 app packaging also passed at
`/tmp/talio-visual-performance-20261019/mac-arm64/Talio.app`. The app and both
native helpers passed Developer ID signature verification; main/preload,
performance policy, visual executor and action validator in app.asar match the
current source byte-for-byte. The removed semantic/transport modules are absent.
Notarization was skipped as previously requested. This validation bundle is not
installed over the user's app and is not a new public release. The web build
configuration skips lint and static type checking; those are not claimed passed.

## 2026-10-19 camera notch and contextual filler refinement (local)

- Camera preview is black with no border/shadow, rounded lower corners and an
  elastic enter/retract animation. Native animation waits until the window is
  shown. Reduced-motion mode disables it. Mac width comes from NSScreen auxiliary
  top areas and joins the bottom of the hardware notch; the helper measured 185
  points wide, 32 high on this Mac. Apple exposes notch geometry, not corner radius;
  the lower curve is visually tuned to 14px. Other displays/web use a compact
  top-center fallback. A browser cannot read physical Mac notch geometry.
- AI-requested camera use calls getUserMedia directly using setup/OS permission,
  without another in-app consent dialog. OS/browser permission gates remain intact.
  Close, device-ended, Mira-dismiss and the two-minute timeout still stop tracks.
- Snapshot capture waits for three decoded frames and rejects black/white/flat
  startup buffers within an eight-second readiness deadline. Track state is checked
  before upload and after analysis; closing aborts and discards late results.
- Voice and chat requests carry bounded current camera state and capture time.
  Tool continuations refresh that state. Prompt policy distinguishes a historical
  snapshot from live sight and forbids claiming current vision after closure.
- 720 unique English/Hindi filler variants: 12 categories, 10 curated cores per
  language/category, three openings. Selection avoids recent exact phrases and
  nearby core paraphrases within a call. Only selected phrases are synthesized,
  using the current voice/language; there is no bulk generation or query storage.
  An audible filler finishes before answer playback; an unstarted filler is
  cancelled. Interruption/closure cancels immediately; a stalled handoff is bounded.

Validation: 1,061 JavaScript tests passed, 18 optional tests skipped; production
web build passed (its existing configuration skips lint/type checks). Swift
type-check and native compilation passed. Browser fixture verified a black,
borderless centered 240px preview at a 320px viewport, with no horizontal overflow,
working close/reopen and error states. The fixture never opened a camera.

Signed arm64 validation bundle:
`/tmp/talio-camera-fillers-final-20261019/mac-arm64/Talio.app`.
Deep/strict signature verification passed. Packaged main.js and notch geometry
module match source; packaged helper returned the measured hardware geometry.
Notarization remains skipped. This is not an installed app, deployment, or GitHub
release. Real camera/provider, audible-speaker, and Windows/Linux native visual
acceptance remain unverified by this pass.

## 2026-10-19 live follow-up and 6.0.32 preparation

- Ran the signed arm64 validation bundle against the local production web build
  on port 3010 (not the older hosted application). The authenticated dashboard
  and real microphone started successfully.
- The user reported passing English speech, switching to Hindi, interruption,
  non-overlapping fillers and spoken dismissal. The closed Mira UI was then
  independently observed. This is user-reported acoustic acceptance, not a
  measurement of echo rejection in every environment. Unrelated background
  speech appeared in the conversation history; nearby-speaker rejection is not
  guaranteed and is not claimed by this release.
- Live DeepSeek semantic regression: 10/10 cases passed. Baseline regression:
  1,061 JavaScript tests passed, 18 optional cases skipped; 12 Python worker
  tests passed.
- The user authorized one camera snapshot to Pollinations. A delayed UI submit
  was mistakenly retried by the tester, causing two provider requests (both
  succeeded). This exceeded the one-frame test authorization and was disclosed
  immediately. Mira was closed and no further snapshots were requested.
- Added synchronous duplicate-in-flight chat suppression and concurrent camera
  inspection rejection, with regression tests. Different instructions still
  interrupt a chat turn; intentional retries remain possible after completion.
- Final regression after those guards and 6.0.32 release metadata: 1,063
  JavaScript tests passed, 18 optional cases skipped. The production web build
  passed; its existing configuration skips lint and type checking.
- After closure, the live reply explicitly said the camera was off and it could
  not currently see the user. It did not reopen the camera. The separate native
  preview placement was not independently observed during this capture pass.
- Release 6.0.32 retains Developer ID signing and the owner's explicit
  signed-but-unnotarized mode. Windows/Linux hands-on camera/audio checks and
  installed-update permission continuity remain unverified. CI artifact builds
  are not substitutes for those hardware checks.

References: Apple NSScreen auxiliaryTopLeftArea/safeAreaInsets; MDN
HTMLVideoElement.requestVideoFrameCallback; Electron BrowserWindow.setBounds
(macOS menu-bar positioning constraints).
