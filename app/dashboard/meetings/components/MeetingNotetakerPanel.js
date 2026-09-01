'use client'

import {
  HiOutlineExclamationTriangle,
  HiOutlineXMark,
} from 'react-icons/hi2'

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
  error,
  transcript = [],
  onClose,
}) {
  if (!isOpen) {
    return null
  }

  const latestTranscript = [...transcript].slice(-24).reverse()

  return (
    <aside className="absolute inset-0 z-20 flex min-h-0 w-full flex-shrink-0 flex-col border-l border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900 sm:relative sm:inset-auto sm:w-[26rem] xl:w-[30rem]">
      <div className="flex min-h-0 flex-1 flex-col bg-white dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-4 dark:border-slate-800 sm:px-5">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Transcript History</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Latest segments appear first and are saved to the meeting record.
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-200">
              {transcript.length} saved
            </span>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white"
              title="Close transcript"
              aria-label="Close transcript"
            >
              <HiOutlineXMark className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {error && (
            <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-200">
              <div className="flex items-start gap-2">
                <HiOutlineExclamationTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <p>{error}</p>
              </div>
            </div>
          )}

          {latestTranscript.length === 0 ? (
            <div className="flex h-full min-h-[240px] items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-400">
              Transcript segments will appear here as Mira captures and saves speech from the live meeting microphone.
            </div>
          ) : (
            <div className="space-y-3">
              {latestTranscript.map(segment => (
                <div
                  key={segment.segmentId || `${segment.speakerName}-${segment.timestamp}-${segment.text}`}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/60"
                >
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                      {segment.speakerName || 'Unknown speaker'}
                    </p>
                    <div className="flex flex-shrink-0 items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="uppercase">{segment.language || 'auto'}</span>
                      <span>{formatTime(segment.timestamp)}</span>
                    </div>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700 dark:text-slate-200">{segment.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
