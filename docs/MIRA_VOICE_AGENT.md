# Mira voice agent

Live voice uses the ElevenLabs Agents JavaScript SDK with the private `Mira`
agent and `eleven_v4_turbo`. The existing Talio/DeepSeek pipeline remains the
only reasoning and action engine. The provider's custom-LLM endpoint returns
a deterministic `ask_mira` client-tool call; the authenticated browser runs
the normal chat/action flow and returns the verified final speech. No second
LLM is charged or allowed to execute actions separately.

## Configuration

- Keep `ELEVENLABS_API_KEY` and `JWT_SECRET` server-only.
- `MIRA_AGENT_PUBLIC_ORIGIN` optionally selects the public HTTPS Talio origin;
  it defaults to `https://app.talio.in`. Never use an untrusted request host.
- Deploy `/api/ai/mira-agent/llm` and its `/chat/completions` compatibility
  route before attempting live agent conversations. ElevenLabs appends the
  OpenAI endpoint suffix to its configured custom-LLM URL and nests client
  extra parameters under `elevenlabs_extra_body` in callback requests.
- In Settings → MIRA, an administrator can create/sync the agent. Its ID,
  configuration hash and sync time live in the tenant's existing
  `servicesettings/mira` record, alongside the access policy. A stale prompt
  blocks session creation until synced rather than silently using a different
  system prompt.

`lib/miraSystemPrompt.js` is the shared personality source. Chat adds its
authorized per-user context and action instructions; the agent transports
the result. User knowledge and personal preferences are not uploaded as a
global provider knowledge bank. Raw user JWTs are never sent to ElevenLabs;
the gateway uses a separately signed, audience-scoped credential lasting no
longer than the original login or the 10-minute voice session plus one minute.
The original account/session, tenant plan and designation are rechecked on
each gateway turn. Voice credentials are not accepted as application logins.

## Voice compatibility and behavior

Audio processors are self-hosted under versioned `/mira/worklets/` paths.
The voice hook sets both `workletPaths` and `libsampleratePath`: microphone,
playback and Safari/device resampling never need CSP-blocked blob/data scripts
or an external CDN. Do not relax `script-src` to solve audio startup errors.
After upgrading a voice dependency, update the versions/paths in
`scripts/sync-mira-worklets.cjs` and the hook, run the sync script and commit
the generated assets and their upstream licenses. Regression tests compare
the bundled assets with the installed versions to prevent drift.

ElevenLabs currently rejects Instant Voice Clones with custom-LLM agents.
The curated MIRA and Mansi voices are instant clones; previews retain those
voices, but live conversations explicitly fall back to Alisha, an Indian
professional conversational voice verified on the account with v4 Turbo.
Alisha, Aria, Laura, Lily and Sarah are compatible live selections.
Microphone activation starts a continuous signed ElevenLabs Agents audio
call, not browser dictation followed by separate TTS. The call indicator shows
connection, listening and speaking status plus an explicit End call control.
Scribe realtime recognition uses Hindi/Hinglish-friendly defaults and English
and Hindi language presets. Chat is the call transcript. Both the shared agent
prompt and Talio brain receive the same live-call context: they can acknowledge
that spoken words reached Mira without claiming to diagnose raw audio quality.

The SDK handles turn detection and interruptions. Speculative turns and
timeout retranscription are disabled. Only final transcripts can run tools;
duplicate tool IDs or retries on the same transcript reuse the same promise.
Interruptions abort generation and suppress obsolete speech, never replaying
an uncertain write. An already committed action cannot be undone by barge-in.

Listening acknowledgements are optional, not model-generated task responses:
one after at least six seconds of sustained voice activity, no more than once
every 18 seconds, never while Mira is responding. Clear Roman Hindi cues use
`Achha.`; other/unknown languages use neutral `Hmm.` rather than guessing a
language from script. Each PCM clip is bounded to four seconds. Clear English
cues also allow `Okay.`; at most three small clips are cached per session.
Ordinary thinking also has a single provider soft-timeout acknowledgement.
The agent microphone starts only on voice activation; existing local wake
detection remains separate and is suspended during the SDK session.
Closing/unmounting ends the agent session/audio.

## Access and rollout

Settings → MIRA exposes administrator-only master and L1–L9 switches. Roles
and employee designations are not modified. Legacy access remains unchanged
until a policy is explicitly saved; after saving, unassigned/inactive
employees are denied. Administrators retain access to policy management even
if their own level or the master switch is off. Both the header/provider mount
and all Mira execution APIs enforce the policy. Cached tenant flags cannot
grant per-user access. Other open clients refresh on focus; server-side changes
take effect on the next request even before that UI refresh.

Before production acceptance, deploy the gateway and test a real microphone
conversation, permission denial, language switching, interruptions during a
reply/action, headphones and speaker echo cancellation. Provider inference
latency is not the same as end-to-end action/reply latency.
