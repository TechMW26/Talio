'use client'

import ModalPortal from '@/components/ModalPortal'
import {
  HiOutlineArrowPath,
  HiOutlineBolt,
  HiOutlineCloudArrowUp,
  HiOutlineCpuChip,
  HiOutlineExclamationTriangle,
  HiOutlineLanguage,
  HiOutlineMicrophone,
  HiOutlineSparkles,
  HiOutlineXMark,
} from 'react-icons/hi2'

const MODE_META = {
  whisper: {
    label: 'Local Whisper',
    detail: 'On-device transcription with automatic ElevenLabs cloud fallback when the browser model fails.',
    icon: HiOutlineCpuChip,
    chipClass: 'bg-indigo-50 border-indigo-200 text-indigo-700',
  },
  elevenlabs: {
    label: 'ElevenLabs Scribe',
    detail: 'Cloud transcription from live microphone chunks. This is the most stable mode for desktop environments.',
    icon: HiOutlineCloudArrowUp,
    chipClass: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  },
  'speech-recognition': {
    label: 'Browser Speech Recognition',
    detail: 'Browser-provided speech recognition fallback when local and cloud chunk transcription are unavailable.',
    icon: HiOutlineMicrophone,
    chipClass: 'bg-amber-50 border-amber-200 text-amber-700',
  },
  unsupported: {
    label: 'Unavailable',
    detail: 'This environment does not expose the browser APIs needed for live Mira transcription.',
    icon: HiOutlineExclamationTriangle,
    chipClass: 'bg-rose-50 border-rose-200 text-rose-700',
  },
}

function formatTime(timestamp) {
  if (!timestamp) return '--:--'

  return new Date(timestamp).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function MeetingNotetakerPanel({
  isOpen,
  mode = 'unsupported',
  isReady,
  isLoading,
  isProcessing,
  error,
  transcript = [],
  languages = [],
  activeSpeakers = [],
  canUseCloud = false,
  canUseLocal = false,
  onUseCloud,
  onUseLocal,
  onClose,
}) {
  if (!isOpen) {
    return null
  }

  const latestTranscript = [...transcript].slice(-24).reverse()
  const modeMeta = MODE_META[mode] || MODE_META.unsupported
  const ModeIcon = modeMeta.icon

  const statusText = isLoading
    ? 'Preparing transcription'
    : isProcessing
      ? mode === 'elevenlabs'
        ? 'Uploading current segment'
        : 'Transcribing current segment'
      : isReady
        ? 'Listening'
        : 'Paused'

  return (
    <ModalPortal show={isOpen}>
      <div className="modal-overlay" onClick={onClose}>
        <div
          className="relative w-full max-w-5xl max-h-[92vh] overflow-hidden rounded-[32px] bg-white shadow-2xl animate-modal-enter flex flex-col"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="border-b border-gray-200 bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950 px-5 py-5 sm:px-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-white">
                  <HiOutlineSparkles className="h-5 w-5 text-cyan-300" />
                  <h2 className="text-lg font-semibold">Mira Live Transcription</h2>
                </div>
                <p className="mt-2 max-w-2xl text-sm text-slate-200">
                  {modeMeta.detail}
                </p>
              </div>

              <button
                onClick={onClose}
                className="rounded-full p-2 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
                title="Close Mira"
              >
                <HiOutlineXMark className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${modeMeta.chipClass}`}>
                <ModeIcon className="h-4 w-4" />
                {modeMeta.label}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
                <span className={`h-2.5 w-2.5 rounded-full ${isReady ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                {statusText}
              </span>
              {canUseCloud && mode !== 'elevenlabs' && (
                <button
                  onClick={onUseCloud}
                  className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
                >
                  <HiOutlineCloudArrowUp className="h-4 w-4" />
                  Switch To ElevenLabs
                </button>
              )}
              {canUseLocal && mode !== 'whisper' && (
                <button
                  onClick={onUseLocal}
                  className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
                >
                  <HiOutlineArrowPath className="h-4 w-4" />
                  Try Local Whisper
                </button>
              )}
            </div>
          </div>

          <div className="grid flex-1 min-h-0 gap-0 lg:grid-cols-[340px_minmax(0,1fr)]">
            <div className="border-b border-gray-200 bg-slate-50 p-5 lg:border-b-0 lg:border-r lg:p-6">
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Status</p>
                  <p className="mt-2 text-lg font-semibold text-slate-900">{statusText}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {isProcessing
                      ? 'Mira is working on the latest captured audio segment.'
                      : isReady
                        ? 'The current provider is ready and monitoring the meeting microphone.'
                        : 'Mira is waiting for microphone access or a supported transcription provider.'}
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Detected Languages</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {languages.length > 0 ? languages.map(language => (
                      <span
                        key={language}
                        className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700"
                      >
                        <span className="inline-flex items-center gap-1">
                          <HiOutlineLanguage className="h-3.5 w-3.5" />
                          {language}
                        </span>
                      </span>
                    )) : (
                      <span className="text-sm text-slate-500">Languages will appear here once Mira captures speech.</span>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Active Speakers</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {activeSpeakers.length > 0 ? activeSpeakers.map(name => (
                      <span
                        key={name}
                        className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"
                      >
                        <span className="inline-flex items-center gap-1">
                          <HiOutlineBolt className="h-3.5 w-3.5" />
                          {name}
                        </span>
                      </span>
                    )) : (
                      <span className="text-sm text-slate-500">Speaker highlights appear after transcript segments are saved.</span>
                    )}
                  </div>
                </div>

                {error && (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                    <div className="flex items-start gap-2">
                      <HiOutlineExclamationTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                      <p>{error}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex min-h-0 flex-col bg-white">
              <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 sm:px-6">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Transcript History</h3>
                  <p className="mt-1 text-xs text-slate-500">Latest segments appear first. Mira keeps saving them to the meeting record.</p>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                  {transcript.length} saved
                </span>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
                {latestTranscript.length === 0 ? (
                  <div className="flex h-full min-h-[260px] items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
                    Transcript segments will appear here as Mira captures and saves speech from the live meeting microphone.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {latestTranscript.map(segment => (
                      <div
                        key={segment.segmentId || `${segment.speakerName}-${segment.timestamp}-${segment.text}`}
                        className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                      >
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            {segment.speakerName || 'Unknown speaker'}
                          </p>
                          <div className="flex flex-shrink-0 items-center gap-2 text-xs text-slate-500">
                            <span className="uppercase">{segment.language || 'auto'}</span>
                            <span>{formatTime(segment.timestamp)}</span>
                          </div>
                        </div>
                        <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{segment.text}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}