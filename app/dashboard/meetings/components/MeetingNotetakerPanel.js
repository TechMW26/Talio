'use client'

import {
  HiOutlineBolt,
  HiOutlineCloudArrowUp,
  HiOutlineExclamationTriangle,
  HiOutlineLanguage,
  HiOutlineSparkles,
  HiOutlineXMark,
} from 'react-icons/hi2'

const MODE_META = {
  elevenlabs: {
    label: 'Mira Notetaker',
    detail: 'Cloud transcription from live microphone chunks for a single, consistent Mira transcription pipeline.',
    icon: HiOutlineCloudArrowUp,
    chipClass: 'bg-emerald-50 border-emerald-200 text-emerald-700',
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
    timeZone: 'Asia/Kolkata',
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
    <aside className="w-full sm:w-[26rem] xl:w-[30rem] bg-white dark:bg-gray-950 border-l border-gray-200 dark:border-gray-800 shadow-lg flex flex-col flex-shrink-0 min-h-0">
      <div className="border-b border-slate-900/40 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 px-4 py-4 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-white">
              <HiOutlineSparkles className="h-5 w-5 text-cyan-300" />
              <h2 className="text-base font-semibold sm:text-lg">Mira Live Transcription</h2>
            </div>
            <p className="mt-2 text-sm text-slate-200">
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

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${modeMeta.chipClass}`}>
            <ModeIcon className="h-4 w-4" />
            {modeMeta.label}
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
            <span className={`h-2.5 w-2.5 rounded-full ${isReady ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            {statusText}
          </span>
        </div>
      </div>

      <div className="border-b border-gray-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-900 p-4 sm:p-5">
        <div className="space-y-3">
          <div className="rounded-2xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-950 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-gray-300">Status</p>
            <p className="mt-2 text-lg font-semibold text-slate-900 dark:text-white">{statusText}</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-white">
              {isProcessing
                ? 'Mira is working on the latest captured audio segment.'
                : isReady
                  ? 'The current provider is ready and monitoring the meeting microphone.'
                  : 'Mira is waiting for microphone access or a supported transcription provider.'}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-950 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-gray-300">Detected Languages</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {languages.length > 0 ? languages.map(language => (
                <span
                  key={language}
                  className="rounded-full border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-900 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-white"
                >
                  <span className="inline-flex items-center gap-1">
                    <HiOutlineLanguage className="h-3.5 w-3.5" />
                    {language}
                  </span>
                </span>
              )) : (
                <span className="text-sm text-slate-500 dark:text-white">Languages will appear here once Mira captures speech.</span>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-950 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-gray-300">Active Speakers</p>
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
                <span className="text-sm text-slate-500 dark:text-white">Speaker highlights appear after transcript segments are saved.</span>
              )}
            </div>
          </div>

          {error && (
            <div className="rounded-2xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 p-4 text-sm text-rose-700 dark:text-white">
              <div className="flex items-start gap-2">
                <HiOutlineExclamationTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <p>{error}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col bg-white dark:bg-gray-950">
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 px-4 py-4 sm:px-5">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Transcript History</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-white">Latest segments appear first. Mira keeps saving them to the meeting record.</p>
          </div>
          <span className="rounded-full bg-slate-100 dark:bg-gray-900 px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-white">
            {transcript.length} saved
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {latestTranscript.length === 0 ? (
            <div className="flex h-full min-h-[240px] items-center justify-center rounded-3xl border border-dashed border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-900 p-8 text-center text-sm text-slate-500 dark:text-white">
              Transcript segments will appear here as Mira captures and saves speech from the live meeting microphone.
            </div>
          ) : (
            <div className="space-y-3">
              {latestTranscript.map(segment => (
                <div
                  key={segment.segmentId || `${segment.speakerName}-${segment.timestamp}-${segment.text}`}
                  className="rounded-2xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-900 p-4"
                >
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                      {segment.speakerName || 'Unknown speaker'}
                    </p>
                    <div className="flex flex-shrink-0 items-center gap-2 text-xs text-slate-500 dark:text-white">
                      <span className="uppercase">{segment.language || 'auto'}</span>
                      <span>{formatTime(segment.timestamp)}</span>
                    </div>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700 dark:text-white">{segment.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
