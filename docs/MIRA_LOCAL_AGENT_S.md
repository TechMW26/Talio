# Local MIRA desktop control

Agent S3 runs in a bundled Python executable on the user's device. Its task,
trajectory and action selection stay in that process. Vision inference still
sends screenshots to DeepSeek through Talio's authenticated `/api/ai/mira-agent-s`
route. `DEEPSEEK_API_KEY` is server-only; no VPS, local HTTP server, provider key,
or separately installed Python is required by end users.

## Boundaries

- Pinned upstream: simular-ai/Agent-S commit
  `3aa272d23d2994c7bbde1acbbe0ef8e8d06b8693` (Apache-2.0).
- S3 Worker, procedural action descriptions, trajectory and formatting recovery
  are retained. Separate reflection is disabled to avoid a second call per step.
- Upstream `eval` in both formatter and action creation is replaced by an AST
  parser accepting one allowlisted `agent.method(literal arguments)` only.
  The general code agent, shell execution and upstream generated Python runner
  are not exposed. This is a deliberately constrained Agent S integration.
- Click, type, approved keys, scroll, app launch/focus, lock, clarification and
  verified completion are supported. This does not promise every OS operation.
- Native boundary enforces trusted dashboard sender, saved consent, foreground
  identity, one-use observations, expiry, step limit and emergency stop.
- Locked screens cannot be read or controlled. Linux currently requires X11,
  loginctl, xprop, wmctrl and xclip; Wayland input is intentionally unsupported.
- macOS uses the existing signed Swift input helper (14+); Windows/Linux use a
  fixed Python input adapter. Runtime status must succeed before an action.
- No real messages should be sent during QA without an approved recipient and
  exact test content. A simulated or unit test is not live desktop acceptance.

## Build and test

On each target OS/architecture, install Python 3.12 for build time only, then run
`npm ci` and `npm run build:agent-s` from `desktop-app`. This installs a pinned
Agent S revision without unused legacy-generation dependencies, runs adapter
tests, freezes the runtime, copies its license and exercises packaged IPC.
Set `AGENT_S_BUILD_PYTHON` if Python 3.12 is not the default executable.

The native runtime must exist under `desktop-app/build/agent-s-<platform>-<arch>`
before electron-builder runs. macOS and Windows/Linux resources are isolated;
cross-building an installer cannot accidentally copy a macOS Python executable.
The manual GitHub Actions matrix builds all four supported release targets.
CI artifacts are not automatically published; macOS CI artifacts are unsigned
and require signing on the release machine before distribution.

Server configuration: `DEEPSEEK_API_KEY`; optional `DEEPSEEK_DESKTOP_MODEL`
(defaults to `deepseek-flash`, must support images and chat completions).
Existing older apps use the legacy endpoint until updated.

## Release acceptance

Require packaged worker smoke tests, authenticated model proxy checks, native
open/focus/search tests, cancellation, permissions and lock-screen checks.
Native Windows/Linux GUI acceptance and real meeting PiP verification are
separate from cross-platform package creation and must be reported explicitly.

### Verified locally on 25 September 2026

- 44 focused JavaScript tests passed; four Python adapter/Agent S tests passed.
- Production Next build passed (267 pages; repository skips lint/type checks).
- Frozen macOS ARM worker startup, inference exchange, continuity and restart passed.
- Live DeepSeek synthetic vision response: approximately 0.7 seconds.
- Supervised real WhatsApp test through frozen Agent S + DeepSeek + Swift helper:
  open/focus, search-field click, type `Mansi`, verify search results. Four decisions
  took approximately 1.0, 3.6, 1.3 and 1.8 seconds respectively. No conversation
  was selected and no message was sent. Search results were independently viewed.
- This was a local end-to-end component test, not an authenticated production
  MIRA chat acceptance test. Windows/Linux GUI acceptance remains outstanding.
