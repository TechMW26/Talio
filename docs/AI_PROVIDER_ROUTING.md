# AI provider routing

Text generation, including the legacy `lib/gemini.js` imports, uses DeepSeek.
MIRA streaming uses the same provider through `streamContent`.

- Routine chat, MIRA chat, spellcheck, JSON and creative requests: `deepseek-flash`, thinking disabled for latency.
- MIRA actions, analysis and reasoning: `deepseek-v4-pro`, thinking enabled. A missing Pro model (404) may fall back to Flash, never Pollinations.
- Image understanding / OCR / stitched screenshot analysis: Pollinations vision.
- Pollinations is reserved for vision and image generation; its former text/streaming exports and audio calls have been removed.
- Audio remains on ElevenLabs: existing MIRA voice, Scribe meeting transcription, and call-alert TTS. DeepSeek does not replace speech APIs.

Server-only environment variables: `DEEPSEEK_API_KEY`, optional `DEEPSEEK_FLASH_MODEL`, `DEEPSEEK_PRO_MODEL`, `DEEPSEEK_TIMEOUT_MS` (default 60000).
Retain `POLLINATIONS_API_KEY` and `POLLINATIONS_VISION_MODEL` for vision.
MIRA image generation uses `POLLINATIONS_API_KEY` and optionally `POLLINATIONS_IMAGE_MODEL` (default `openai/gpt-image-2.5-sunburst`, quality-first). It requires a funded Pollinations account. Configured private Vercel Blob storage is preferred; otherwise images are stored in the tenant MongoDB, capped at 8 MB each and excluded from default model projections. Text continues to use DeepSeek.

An explicit image request produces a validated `generate_image` action. The browser submits it once to `/api/ai/mira-images`; the authenticated server generates one 1024px image, validates/re-encodes it as PNG, and stores it privately. Tenant-scoped metadata binds each image to its owner; `/api/ai/mira-images/[id]` checks ownership before delivery. Only opaque IDs are saved in chat history. The default per-user limit is five requests per hour. Request IDs prevent duplicate execution, cancellation stops upstream work, and paid requests are not automatically retried.

The chat displays the lazy-loaded `img-fx` pixel mosaic while generating and reveals the image with a download link. Reduced-motion/no-WebGL clients use a static placeholder. Reopening history retrieves saved images without regenerating them. Image editing and reference uploads are not part of this flow. Stored images are retained independently of chat deletion; operators should include generated images in their tenant storage retention policy.
Audio requires `ELEVENLABS_API_KEY` and TTS requires `ELEVENLABS_VOICE_ID`; optional `ELEVENLABS_STT_MODEL` defaults to `scribe_v2`.
Never put provider keys in `NEXT_PUBLIC_*` variables or tracked templates.

Streaming forwards final-answer content only, never reasoning tokens, and rejects truncated output. User cancellation and deadlines abort upstream requests. Streams are not replayed after partial output. Provider errors do not include raw DeepSeek response bodies.

Validation: focused routing/streaming/audio tests, production build, and live synthetic Flash/Pro/streaming requests. No employee data was sent for smoke tests. Environment changes in Vercel require a new deployment before existing deployments use them.
