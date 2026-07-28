import {
  HiOutlineFaceSmile,
  HiOutlineFire,
  HiOutlineHandRaised,
  HiOutlineHandThumbUp,
  HiOutlineHeart,
  HiOutlineSparkles,
} from 'react-icons/hi2'

export const MEETING_REACTIONS = [
  { value: '👍', label: 'Thumbs up', Icon: HiOutlineHandThumbUp },
  { value: '👏', label: 'Applause', Icon: HiOutlineHandRaised },
  { value: '❤️', label: 'Heart', Icon: HiOutlineHeart },
  { value: '😂', label: 'Laugh', Icon: HiOutlineFaceSmile },
  { value: '😮', label: 'Surprised', Icon: HiOutlineSparkles },
  { value: '🎉', label: 'Celebrate', Icon: HiOutlineFire },
]

export function CutLineIcon({ children, isOff = false, className = '', label }) {
  return (
    <span
      className={`relative inline-flex items-center justify-center ${className}`}
      aria-hidden={label ? undefined : 'true'}
      aria-label={label}
      role={label ? 'img' : undefined}
    >
      {children}
      {isOff && (
        <span className="pointer-events-none absolute left-1/2 top-1/2 h-0.5 w-[135%] -translate-x-1/2 -translate-y-1/2 -rotate-45 rounded-full bg-current shadow-[0_0_0_1px_rgba(0,0,0,0.18)]" />
      )}
    </span>
  )
}

export function MeetingReactionIcon({ value, className = 'h-6 w-6' }) {
  const reaction = MEETING_REACTIONS.find(item => item.value === value)
  const Icon = reaction?.Icon || HiOutlineSparkles

  return <Icon className={className} aria-hidden="true" />
}
