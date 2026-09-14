# Meeting media repair — 14 September 2026

## Decision

CANACT's calls use native peer-to-peer WebRTC with Firebase signaling. Talio retains
LiveKit's managed WebRTC SFU for group meetings; dashboard Pusher and existing
meeting notes, chat, guest access, and tenant-scoped tokens are unchanged. Public
shared TURN credentials from the reference application were not copied.

## Repairs

- Keep each video element mounted across camera mute/unmute. The same LiveKit
  track may survive the toggle; replacing the element without re-running its
  attachment effect left remote video blank.
- Use muted video playback plus separate microphone and screen-share audio
  elements. Offer explicit playback recovery when a browser blocks autoplay.
- Refresh participant snapshots on publication changes and reconnects; ignore
  updates from a retired room.
- Show failed publication/device errors, serialize device toggles, and derive
  control state from actual publications.
- Cancel obsolete asynchronous joins and return terminal disconnects to a
  recoverable join flow. Reload/rejoin does not acquire a camera or microphone.
- Permit LiveKit Cloud HTTPS region discovery in both CSP implementations.

## Validation

- Full Jest suite: 102 suites passed, one skipped; 619 tests passed, 18 skipped.
- Production build passed. This repository's build skips lint/type checking;
  it is not evidence of an independent full lint/type-check pass.
- Two isolated Chromium participants used production-issued guest tokens and
  the production LiveKit provider with the updated `MeetingMedia` components
  in a local browser harness under the updated CSP.
- Both participants received remote audio and decoded remote video: sampled
  inbound video counts were 12 and 11 frames; audio bytes were 4,840 and 6,049.
- Camera mute/unmute retained the attached video node. Disconnect/rejoin restored
  subscription and decoded video (12 sampled frames after rejoin).
- Test video came from generated canvas frames and audio from an oscillator.
  Physical `getUserMedia` calls: zero. Exact synthetic meeting fixtures were
  removed; employee records and existing meetings were not changed.

## Acceptance boundary

This proves the tested media flow, not every device/network combination or a
large-room load test. Safari/iOS, corporate firewalls, real device switching,
long-duration calls, and large groups still need user acceptance testing.
The local harness is not a claim that a deployed browser bundle was tested
before release. After rollout, verify the deployed commit and CSP separately.

Useful regression command:

```sh
npx jest --runInBand tests/web/meeting-media.test.js tests/web/managed-meeting-session.test.js tests/web/managed-meeting-source.test.js tests/api/livekit-meeting.test.js tests/api/livekit-token-route.test.js tests/api/security-headers-location.test.js
```
