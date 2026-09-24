# MIRA desktop control

The desktop runtime now exposes a task-scoped computer-control bridge. macOS is
14 or newer is the initial supported platform; browser, Windows and Linux builds do not advertise
this capability. They retain normal Talio navigation and screen-sharing support.

Each task requires native consent, Accessibility and Screen Recording. A fresh
observation is required for every input. Observation IDs are single-use, expire
after 45 seconds, and bind input to the foreground process. Sessions expire after
five minutes or 24 steps. Close MIRA or press Command+Shift+Escape to stop.

Supported inputs: app launch (exact installed name, known web fallback), pointer
click, Unicode typing, limited navigation keys, scroll and explicit laptop lock.
The native bridge does not expose shell execution. Terminal, password, keychain
and System Settings input is blocked. The vision executor must stop for ambiguous
recipients, login, MFA, permissions, purchases and deletions. Screenshots are sent
to the existing vision provider and are not persisted by this integration.

Builds compile a Swift helper per architecture through `beforePack`. The helper
is placed in the macOS Resources directory and included in signing. To compile a
development helper, run `node -e "require('./desktop-app/scripts/build-mira-control')({electronPlatformName:'darwin',arch:3})"` (arm64; use 1 for x64).

The persistent permission checklist rechecks on focus and every ten seconds,
without repeatedly opening OS dialogs. macOS may require app restart after a
screen-recording change. Browser-owned PiP chrome and OS focus restrictions
cannot be overridden; desktop navigation uses the native reveal bridge.

Knowledge records are generated from all App Router pages and recursively imported
UI components, including literal labels in option objects. Dynamic/user-defined
controls still require live UI inspection. Relevant dashboard records are retrieved
per request as reference context, not appended as a full system prompt. The client
navigation bundle only imports the small generated route list.
