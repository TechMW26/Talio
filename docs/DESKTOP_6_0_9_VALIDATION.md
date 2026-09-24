# Desktop 6.0.9 validation

## Changes

- Explicit WhatsApp and other named external-app commands route before Talio people lookup. Desktop tasks retain their goal for clarification follow-ups.
- Pure app-opening commands dispatch native opening before a model round trip; completion still requires a fresh observation.
- Native macOS app matching strips invisible direction marks. WhatsApp text insertion uses paste with clipboard restoration; other apps retain Unicode keyboard input.
- Cursor windows explicitly request a transparent backing color.
- MIRA and meeting in-app PiPs and unsaved native PiP windows default bottom-right. Saved native drag positions are preserved. The shared native window keeps meetings above MIRA.
- Meeting controls wrap instead of clipping centered overflow; the native participant area has a minimum height and scrolls.
- Original TalioBoard templates are restored, and desktop window controls have reserved header space.

## Checks performed

- 94 focused automated tests across 12 suites passed.
- Next.js production compilation and 266-page generation passed. The repository build skips lint/type validation.
- macOS native helper brought the existing WhatsApp instance forward; searched a first name and displayed WhatsApp matches; searched a nonexistent name and displayed No results. Test search was cleared. No message was sent.
- Live vision provider correctly interpreted the WhatsApp No results screenshot.
- Isolated Cocoa fixture verified actual mouse click, Unicode input and verification-button activation.

## Acceptance boundaries

The native helper test and live provider test are separate checks, not a full authenticated production MIRA conversation. Live meeting media/PiP visual acceptance and Windows/Linux runtime acceptance remain unverified. Computer input automation remains macOS-only in the existing implementation; building Windows/Linux does not add native computer control there.

Browser-owned Document PiP placement and title chrome are controlled by the browser. Bottom-right positioning is enforced for in-app surfaces and Electron native windows, not guaranteed for browser-owned windows.

Release signing remains Developer ID signed but not notarized on macOS, and unsigned on Windows, as previously approved.
