# Local Hey MIRA and voice conversation

Uses the Apache-2.0 Vosk small English model in a browser worker. The roughly
40 MB model is served from Talio; microphone PCM goes only to that local worker.
Wake listening defaults to on, subject to browser/OS microphone permission.
Startup is attempted once unless the account has explicitly stopped it on this
device. Blocked startup shows Enable again without a retry loop.
Stop is available in Hey MIRA controls under Privacy & settings; there is no
floating stop button. Disabling stops tracks,
the AudioContext and the worker; delayed permission responses are stopped too.
Wake detection releases its microphone during voice chat, then resumes afterward.
Explicit Stop saves an off preference and prevents automatic resumption. No polling or retry
loop is used. Closed apps, OS sleep, and browser suspension are not supported.

When wake listening is off, the desktop header shows a small Enable reminder
beside Ask MIRA. Dismissing snoozes it for one hour, persisted per account/device
across reloads and synchronized across tabs. It returns only while listening is
off, and rechecks overdue reminders on focus after browser suspension. Loading,
enabled listening and an active voice conversation suppress it. Enable starts
the existing local listener; it does not bypass microphone permission.

There is no training or recording step. Detection accepts final, confident,
adjacent words: exactly `hey` followed by `mira`, with at least 90% confidence
for each word and a six-second cooldown. Standalone names, fuzzy variants and
partial transcripts never activate MIRA. Other people can trigger MIRA. Old local
voice checks are not read or used and can be deleted in Privacy & settings.
No new samples are stored. Wake recognition has no cloud fallback. The wake-only
recognizer uses a constrained phrase grammar, including an unknown-word branch.

## Acceptance still required

- Test the actual model against multiple speakers, accents, background speech,
  music, microphone distances and similar phrases. Unit tests are not acoustic
  accuracy evidence. If the vocabulary cannot recognize Mira reliably, replace
  the detector before calling this production ready.
- Verify the downloaded model initializes in each supported browser and Electron.
- Package and test desktop wake restoration. The restricted Electron bridge now
  restores and focuses the existing Talio window when its dashboard detects a wake
  word. It preserves the existing voice session instead of creating a second
  microphone owner. This is not a separate OS-level popup window. Background
  browser execution is best-effort.
- Meeting-microphone coordination still needs acceptance testing.

## Voice conversation

Chat requests use provider SSE streaming. Only the leading message string is
shown incrementally; cards and actions wait for complete JSON validation.
Cancelled requests abort generation; incomplete streams show a retryable error.
Employee, scoped dashboard and public-search context are fetched concurrently.
Simple greetings skip dashboard queries. Latest-message language takes priority
over older conversation language. These changes reduce application-side waiting,
but provider first-token latency still applies. TTS currently starts from the
completed reply, not partial JSON text.

The composer microphone streams to ElevenLabs Scribe v2 Realtime using a
server-issued, short-lived single-use token. Language is detected automatically
(no hardcoded English language setting). This path works through Web Audio and
WebSocket in supported browsers and Electron. Conversation microphone audio is
sent to ElevenLabs; the ambient wake-word worker is still local-only. Partial text
appears in the composer placeholder; each final utterance is sent to the existing
authenticated MIRA chat API. Only text, not microphone audio, is sent to that API.
Reply text goes through the authenticated, rate-limited `/api/ai/mira-voice` route
to ElevenLabs v3 by default. `MIRA_TTS_MODEL` can select `eleven_flash_v2_5`
for lower latency or `eleven_multilingual_v2`. Hindi responses specify `hi`
and text normalization is enabled. Only server-side `ELEVENLABS_API_KEY` and
`ELEVENLABS_VOICE_ID` are used; never use public-prefixed keys. PCM audio is played
as chunks arrive, not after downloading the whole file. The first text chunk is
at most 120 characters, subsequent chunks at most 280, with sentence-aware splits
and one-chunk lookahead. Cancellation aborts queued provider work. Speech requests start
when the chat reply is ready, before session persistence completes. LLM text
generation itself is still non-streaming. Recognition stays active during
playback; a non-echo utterance cancels queued audio and allows a new turn.
This is not a hosted ElevenLabs realtime agent or a native wake engine.
Closing the panel or pressing Stop shuts down capture and cancels speech. Late
responses cannot start playback after stopping. No microphone starts on mount.

No training or introductory popup appears on successful automatic startup.
The recovery prompt appears if startup fails; Enable closes it once ready.
Privacy details and old-sample deletion remain under the collapsed settings section.
The first recognition start loads the local model and is slower than later cached
loads. Real-device acoustic accuracy and end-to-end conversation latency remain
unverified. One live synthetic ElevenLabs test returned audio successfully with
first bytes in approximately 3.5 seconds; that is not an instant-response guarantee.

Build and focused consent/cancellation tests pass. No native desktop release or
production deployment has been performed for this preview.

## Chat context and layout

The latest reply contributes at most three deduplicated follow-ups to the fixed
composer area. Relevant task data and validated stat/list/table JSON render inline
without a supporting-details dropdown. Task breakdown rows remain clickable.
Every turn includes a fresh,
permission-scoped dashboard baseline (attendance, task overview, own leave and
upcoming meetings). Detailed context remains intent-scoped and bounded, not an
unrestricted database dump. Current page/timezone are validated client hints.
Device location is captured once on chat open only with an already-granted
permission, expires after five minutes, and is explicitly unverified. Recorded
check-in location is separately labelled, never presented as live GPS.

Live Scribe handshake confirmed automatic language detection. A synthetic Hindi
TTS-to-Scribe round trip returned a Hindi transcript with the English term
attendance intact. Real microphone accuracy, mixed-language switching and overall
latency still need device QA.

## Persistent workspace assistant

Dismissal phrases such as "bye", "adios", "go away", "close the popup", and
"अलविदा" are handled locally on final transcripts, even while thinking or speaking.
They stop conversation capture/playback and close both full chat and floating PIP.
The existing enabled wake-word listener resumes; a previously disabled wake-word
preference is not overridden. Typed dismissals and model-recognized equivalent
intent also close the session. Quoted/translation requests are not local dismissals.

The dashboard layout owns the MIRA component, outside the page-transition subtree.
Allowlisted navigation uses the Next router and minimizes to an in-app voice-only
bottom-left floating card; it does not close the voice hook. Display mode is owned
by the persistent chat provider, so sidebar remounts and new replies cannot restore
the full chat. Use the PiP restore control, Ask MIRA, “Show chatbox” or “Switch to
full width view” to explicitly restore a larger view. Wake detection while already
open does not change display mode. Manual page changes also minimize
an active voice session. Restore reopens the same conversation. This is not an
OS-level window, and a hard reload or leaving the dashboard still ends capture.

MIRA can propose task/project/meeting creation, standalone-task assignment, and
messages to private chats, creating the conversation when needed. Complete, clearly
requested actions execute directly, without a redundant Confirm step. Required
fields are validated. Ambiguous names return up to ten database-backed choices
with name, code and department; Hindi phonetic matches always require selection.
Selections are re-resolved server-side. `/api/ai/mira-actions` checks current RBAC permissions,
tenant models and person/task scope, then delegates to existing application APIs.
Non-admin/HR assignment and project-head/member resolution remains limited to self
and direct reports. Contact lookup, messaging and meeting invitations can resolve
active contacts in the authenticated tenant after the corresponding chat/meeting
permission check. Ambiguous names fail closed. New tasks may target a named,
accessible project; reassignment of existing project tasks remains page-only.
Writes are not automatically retried after network errors. Real production writes
were deliberately not performed for testing.

MIRA ordinary chat uses DeepSeek Flash; action-heavy turns use
DeepSeek Pro with Flash as the model-unavailable fallback. Actual action outcomes and
person choices are included in subsequent conversation context. Local tests cover
delegation and state changes, not live model quality or notification delivery.

Action-first response instructions require delivering requested drafts/plans/code
directly and reusing known conversation details. Only exact task-list requests use
the deterministic task-list shortcut, so a request to work on a task reaches the
model. Prepared actions suppress redundant suggested follow-ups. Database changes
require complete fields and an unambiguous person; model instructions do not bypass RBAC.

Internet search ports the original MIRA text-search pipeline: Jina, optional
Brave/Google, Bing and DuckDuckGo fallbacks, relevance fusion and freshness ranking.
The configured MIRA Jina key was copied only into ignored `.env.local`. Deployments
must receive the same server-side secret separately. No article/media crawler or
arbitrary URL fetch is exposed. Public search receives only the public query, not
database context/history. Weather needs a city and cites search evidence, not a
dedicated sensor feed. A live fallback search returned results in about six seconds.

Standalone confident "Mira" and two stable exact partials can activate the local
detector. Audio capture buffers are 512 samples rather than 4096. This reduces
buffering but is not a validated 100ms wake-word latency guarantee. The recognition
token is prewarmed when chat opens and consumed once; it does not pre-generate a
reply or guarantee a warm provider model. One live v3 Hindi sample returned first
audio in about 1.36 seconds. Speaker pronunciation and native desktop acceptance
still need real-device testing.
