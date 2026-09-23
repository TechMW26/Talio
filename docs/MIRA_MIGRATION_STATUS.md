# MIRA workspace migration — 23 September 2026

> Historical foundation snapshot. Voice conversation, structured cards, public
> text search, persistent in-app PIP and guarded workspace actions have since been
> integrated. See `MIRA_LOCAL_VOICE.md` for current behavior and acceptance limits.
> The feature map below is not a current list of unfinished user requests.

## Implemented locally

- Voice Glow 0.2.1 installed, reacting to an explicitly enabled local microphone and the existing thinking state. Closing MIRA stops capture, including a permission response that arrives after close. This is visualization, not transcription or a voice conversation service.
- Full-width workspace toggle preserves the existing conversation, history, workflow cards, export, slash commands and quick actions.
- Compact Bloub companion adapted from `MIRA/src/components/Chat/MiraBloub.jsx`, with upstream MIT attribution included at `public/licenses/bloub.txt`.
- Fixed neutral-black Talio appearance; theme selectors removed. Whiteboard MIRA remains explicitly light.
- Floating menu callouts and their positioning interval removed. Existing inline new-content dots remain.
- Homepage prioritizes attendance and work. Extra widgets are disclosed on demand; saved widget choices are preserved. Attendance cannot be removed through customization.
- Whiteboard object movement handles persisted empty point arrays, page saves persist pages, and open-editor data is excluded from broad refresh invalidation.

## Source feature map — not yet migrated

Source project: `/Users/aviraj/Desktop/MWFutureTech/MIRA`, not the separate MIRA.IO automation repository.

| Source capability | Integration needed before calling it complete |
| --- | --- |
| ChatInput attachments, fileParser, imageAnalysis | Tenant-authorized private uploads, file type/size validation, safe text extraction, model input limits |
| VoiceModeOverlay / voice conversation | Explicit recording consent, authenticated transcription and speech endpoints, cancellation, audio cleanup and meeting-device conflict tests |
| PromptLibrary / project conversation context | Per-tenant/project access checks and persistence in Talio models rather than MIRA Firebase credentials |
| CanvasPanel / documentExport / Chart / MindMap | Validated structured result schemas, editable artifacts, export and persistence regression coverage |
| Search / crawl / related media | Server-side provider integration, URL validation/SSRF protection, source provenance and quotas |
| Image/video generation | Tenant quotas, provider credentials, job tracking, private output storage and failure handling |
| DesktopWorkspace / terminal / local file and browser tools | Requires a desktop bridge or isolated execution service; cannot be copied into a Vercel request handler |

Do not copy MIRA credentials, Firebase user data, desktop permissions, arbitrary tool execution, or broad file access into Talio. Existing Talio authentication, tenant isolation and workflow authorization remain authoritative.

## Remaining whiteboard work

AI raster image generation and advanced background removal are not integrated. BEN2-ONNX is a free MIT-licensed candidate, but browser runtime/model compatibility must be proven first. The attempted Transformers 4.3.0 install failed on an unavailable ONNX runtime version and was not added as a dependency. Do not claim provider-level or production verification from the local build.

## Verification boundary

Local build and targeted tests, plus browser checks of the existing local authenticated session. No GitHub push or Vercel deployment in this change set. Full feature parity with standalone MIRA is not complete.
