'use client'

import { HiOutlineBolt, HiOutlineLanguage, HiOutlineSparkles, HiOutlineXMark } from 'react-icons/hi2'

function formatTime(timestamp) {
  if (!timestamp) return '--:--'

  return new Date(timestamp).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function MeetingNotetakerPanel({
  isReady,
  isLoading,
  isProcessing,
  error,
  transcript = [],
  languages = [],
  activeSpeakers = [],
  onClose,
}) {
  const latestTranscript = [...transcript].slice(-24).reverse()

  return (
    <div className="w-full sm:w-96 bg-white border-l border-gray-200 shadow-lg flex flex-col flex-shrink-0">
      <div className="p-4 border-b border-gray-200 flex items-center justify-between gap-3 flex-shrink-0">
        <div>
          <h2 className="text-gray-800 font-medium flex items-center gap-2">
            <HiOutlineSparkles className="w-5 h-5 text-indigo-600" />
            AI Notetaker
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            {isLoading
              ? 'Loading on-device Whisper...'
              : isReady
                ? 'Live transcription is active on participant devices.'
                : 'Waiting for microphone and model readiness.'}
          </p>
        </div>

        <button
          onClick={onClose}
          className="p-1 hover:bg-gray-100 rounded"
          title="Close AI notetaker"
        >
          <HiOutlineXMark className="w-5 h-5 text-gray-500" />
        </button>
      </div>

      <div className="p-4 border-b border-gray-200 space-y-3 flex-shrink-0">
        <div className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Status</p>
            <p className="text-sm font-medium text-gray-800">
              {isLoading ? 'Loading model' : isProcessing ? 'Transcribing current segment' : isReady ? 'Listening' : 'Paused'}
            </p>
          </div>
          <div className={`h-2.5 w-2.5 rounded-full ${isReady ? 'bg-emerald-500' : 'bg-amber-400'}`} />
        </div>

        <div className="rounded-xl bg-gray-50 px-3 py-2">
          <p className="text-xs uppercase tracking-wide text-gray-500 flex items-center gap-1">
            <HiOutlineLanguage className="w-4 h-4" />
            Detected Languages
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {languages.length > 0 ? languages.map(language => (
              <span
                key={language}
                className="px-2.5 py-1 rounded-full bg-white border border-gray-200 text-xs font-medium text-gray-700"
              >
                {language}
              </span>
            )) : (
              <span className="text-xs text-gray-500">Auto-detecting from live speech</span>
            )}
          </div>
        </div>

        <div className="rounded-xl bg-gray-50 px-3 py-2">
          <p className="text-xs uppercase tracking-wide text-gray-500 flex items-center gap-1">
            <HiOutlineBolt className="w-4 h-4" />
            Active Speakers
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {activeSpeakers.length > 0 ? activeSpeakers.map(name => (
              <span
                key={name}
                className="px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-700"
              >
                {name}
              </span>
            )) : (
              <span className="text-xs text-gray-500">No one is speaking right now</span>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 min-h-0">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-700">Transcript History</h3>
          <span className="text-xs text-gray-400">Latest first</span>
        </div>

        {latestTranscript.length === 0 ? (
          <div className="h-full flex items-center justify-center text-center text-sm text-gray-400">
            Transcript segments will appear here as participants speak.
          </div>
        ) : (
          <div className="space-y-3">
            {latestTranscript.map(segment => (
              <div
                key={segment.segmentId || `${segment.speakerName}-${segment.timestamp}-${segment.text}`}
                className="rounded-xl border border-gray-200 bg-gray-50 p-3"
              >
                <div className="flex items-center justify-between gap-3 mb-1">
                  <p className="text-sm font-medium text-gray-800 truncate">
                    {segment.speakerName || 'Unknown speaker'}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-gray-500 flex-shrink-0">
                    <span className="uppercase">{segment.language || 'auto'}</span>
                    <span>{formatTime(segment.timestamp)}</span>
                  </div>
                </div>
                <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">{segment.text}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}