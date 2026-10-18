# Mira camera, voice and PiP acceptance — 2026-10-18

## Implementation

- Desktop PiP stores only a deliberate drag, preserving the face's bottom-center
  anchor when a details widget changes its size. Browser PiP uses local storage;
  desktop PiP uses the existing Electron store. Disconnected-display positions
  are clamped to a connected display. First use still defaults bottom-right.
- Direct DeepSeek voice tools now include `close_mira`, `view_camera` and
  `close_camera`. These are model decisions, not transcript keyword matches.
  Closing releases microphone/playback/camera and closes Mira. Echo checks apply
  before dismissal as well: Mira quoting a goodbye must not dismiss herself.
- Typed chat can request camera context through a bounded `read_camera` action.
  Remote relayed commands cannot activate the local camera.
- Camera consent is visible and precedes `getUserMedia`. A top-center notch-style
  preview has a close button and camera-on indicator. On a Mac it sits beneath
  the physical notch/menu-bar work area; software cannot draw inside the notch.
  Desktop uses a separate isolated transparent child window; web uses an overlay.
- Only an explicitly requested snapshot is uploaded to the existing authenticated,
  rate-limited vision endpoint. Images are bounded, stripped of metadata and not
  saved as files or public URLs. Camera video is not recorded. Vision returns a
  question-scoped description limited to 200 words; visible text is untrusted.
- Camera tracks stop on conversation close, component removal, preview close,
  device disconnection, or two minutes without inspection. Desktop lock/sleep
  closes the camera child and stops its capture. No startup camera prompt.
- Partial ASR cannot interrupt speech. Committed non-echo utterances still can.
  Browser AEC/noise suppression, Scribe background filtering and an 80 Hz high-pass
  filter reduce echo/rumble. Automatic gain amplification is disabled. These are
  not speaker authentication and cannot guarantee rejecting every nearby speaker.
- Chromium retains automatic GPU selection and driver/crash safety fallback.
  Removed the forced 512 MB V8 heap and forced GPU backend/rasterization flags.
  Robot canvas clocks share one loop per document, pause when hidden and cap at
  30 fps instead of following 120/144 Hz displays. GPU diagnostics contain feature
  statuses only. `TALIO_DISABLE_GPU=1` remains an explicit troubleshooting override.

## Automated/provider validation

- Mira/control/permission/PiP/signing regression suite: 1,031 passed, 19 optional
  cases skipped across 114 passing suites. Tests cover camera consent, late permission
  resolution, cancellation, track cleanup, auto-off, private snapshot upload,
  corrupt saved positions, restored dimensions and display clamping.
- Production web build passed (259 static pages; project configuration skips
  lint/type checks). Mac arm64 6.0.31 packaged and Developer ID signed locally;
  notarization was skipped because credentials remain unavailable. Windows,
  Linux and Intel Mac installers were not rebuilt in this run.
- Live DeepSeek semantic evaluation: 10/10 synthetic cases passed. English/Hindi
  goodbyes and indirect leave intent selected `close_mira`; negations/quoted
  goodbyes did not. Closing Calculator selected `ask_mira`; drawing/object requests
  selected `view_camera`; camera-off selected `close_camera`. No tools were
  executed by these evaluations and no personal camera frame was uploaded.
- Re-run live cases explicitly with
  `MIRA_SEMANTIC_LIVE=1 npx jest tests/api/mira-semantic-live.test.js --runInBand`.
  The key is loaded from `.env.local` without printing it; ordinary CI skips these
  paid provider checks. Finite examples are regression evidence, not a guarantee
  of perfect language intent recognition.

## Live macOS follow-up

- After the user unlocked the Mac and explicitly authorized preview plus one
  vision snapshot, the exact rebuilt `dist/mac-arm64/Talio.app` was opened.
  A single camera inspection was requested through the normal Mira chat UI.
  The separate native camera preview displayed live video, and the completed
  response correctly reported that the scene was too dark to distinguish objects.
  No second snapshot was requested. The camera window closed afterward; the
  two-minute auto-off elapsed before the attempted manual-close click.
- The resulting brief description appeared in the closable PiP details widget.
  Closing those details returned to the face-only surface. A deliberate drag
  persisted a 224-by-224 native PiP position in `app-data.json`. Reopening chat
  preserved that stored position. Exact subsequent native-window placement and
  browser refresh restoration still need separate visual acceptance.
- The rebuilt app's GPU diagnostics reported enabled compositing, canvas,
  rasterization, video decode/encode, WebGL/WebGL2 and WebGPU. This verifies
  hardware acceleration is available, not a frame-time or latency guarantee.
- GitHub reported Vercel deployment success for implementation commit
  `be74716cd30f2ab58a0c273322de9dfdce05b2ba`; the rebuilt desktop loaded the
  production dashboard and completed the camera flow there.

## Remaining acceptance / release gate

The user subsequently confirmed that the requested real spoken-dismissal check
closed Mira. This is user-reported acceptance, not a new automated acoustic
measurement; echo rejection in varying speaker/noise conditions remains pending. Windows camera,
native preview placement, PiP reopen positioning and cross-platform acoustic
checks remain pending. Automated fixtures do not replace those checks.

Earlier packaged native-control evidence (Calculator state preservation,
bilingual TextEdit entry, native capture recovery and focus-drift stop) is in
`MIRA_DESKTOP_EXECUTOR_VALIDATION.md`; it is separate from the new camera work.
Public installers must not be published until required acceptance and macOS
notarization pass. The user paused Apple account/notarization setup; local signed
builds are not notarized releases. No sub-250 ms whole-turn latency claim is made.
