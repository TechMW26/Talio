'use client'

import { useEffect, useRef } from 'react'
import { Track } from 'livekit-client'
import { HiOutlineMicrophone, HiOutlineHandRaised } from 'react-icons/hi2'
import { CutLineIcon, MeetingReactionIcon } from './MeetingVisualIcons'

export function RemoteAudio({ participant, source = Track.Source.Microphone }) {
  const ref = useRef(null)
  const publication = participant.getTrackPublication(source)
  useEffect(() => {
    const track = publication?.track
    const element = ref.current
    if (!track || !element) return undefined
    track.attach(element)
    return () => track.detach(element)
  }, [publication?.track])
  return <audio ref={ref} autoPlay data-meeting-audio={source} />
}

export function ParticipantTile({ item, local = false, reaction, handRaised = false, featured = false, compact = false }) {
  const videoRef = useRef(null)
  const screenPublication = item.participant.getTrackPublication(Track.Source.ScreenShare)
  const cameraPublication = item.participant.getTrackPublication(Track.Source.Camera)
  const publication = screenPublication && !screenPublication.isMuted ? screenPublication : cameraPublication

  useEffect(() => {
    const track = publication?.track
    const element = videoRef.current
    if (!track || !element) return undefined
    track.attach(element)
    return () => track.detach(element)
  }, [publication?.track])

  const tileSize = featured
    ? 'h-full min-h-0 w-full'
    : compact
      ? 'h-24 w-36 shrink-0 sm:h-28 sm:w-44'
      : 'min-h-44'

  return (
    <div
      className={`relative flex overflow-hidden bg-slate-200 ring-1 ring-slate-300 dark:bg-slate-900 dark:ring-white/10 ${compact ? 'rounded-xl' : 'rounded-2xl'} ${tileSize}`}
      data-participant-tile={featured ? 'presenter' : compact ? 'rail' : 'grid'}
    >
      {/* Keep this element mounted while muted: the publication can retain the
          same track across unmute, so a newly mounted node would never attach. */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        aria-label={`${item.name} ${item.isScreenSharing ? 'screen share' : 'camera'}`}
        className={`absolute inset-0 h-full w-full ${item.isScreenSharing ? 'bg-black object-contain' : 'object-cover'} ${local && !item.isScreenSharing ? '-scale-x-100' : ''} ${publication?.track && !publication.isMuted ? '' : 'invisible'}`}
      />
      {(!publication?.track || publication.isMuted) && (
        <div className="flex h-full w-full flex-1 items-center justify-center">
          <span className={`flex items-center justify-center rounded-full bg-indigo-600 font-semibold text-white ${compact ? 'h-10 w-10 text-sm' : 'h-16 w-16 text-xl'}`}>
            {item.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}
          </span>
        </div>
      )}
      <div className={`absolute flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-lg bg-black/65 text-xs font-medium text-white backdrop-blur ${compact ? 'bottom-2 left-2 px-2 py-1' : 'bottom-3 left-3 px-2.5 py-1.5'}`}>
        <span className="truncate">{local ? 'You' : item.name}</span>
        {item.isMuted && <CutLineIcon isOff><HiOutlineMicrophone className="h-4 w-4" /></CutLineIcon>}
      </div>
      {item.isScreenSharing && <span className="absolute left-3 top-3 rounded-full bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white">Presenting</span>}
      {handRaised && <span className="absolute right-3 top-3 rounded-full bg-amber-500 p-2 text-white" aria-label={`${item.name} raised their hand`}><HiOutlineHandRaised className="h-5 w-5" /></span>}
      {reaction && (
        <span className="pointer-events-none absolute bottom-10 left-1/2 z-30 -translate-x-1/2 motion-safe:animate-bounce drop-shadow-lg">
          <MeetingReactionIcon value={reaction} className={compact ? 'h-12 w-12' : 'h-20 w-20 sm:h-24 sm:w-24'} />
        </span>
      )}
    </div>
  )
}
