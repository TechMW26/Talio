export const MEETING_REACTIONS = [
  { value: '👍', label: 'Thumbs up', asset: '1f44d' },
  { value: '👏', label: 'Applause', asset: '1f44f' },
  { value: '❤️', label: 'Heart', asset: '2764' },
  { value: '😂', label: 'Laugh', asset: '1f602' },
  { value: '😮', label: 'Surprised', asset: '1f62e' },
  { value: '🎉', label: 'Celebrate', asset: '1f389' },
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

export function MeetingReactionIcon({ value, className = 'h-10 w-10' }) {
  const reaction = MEETING_REACTIONS.find(item => item.value === value)
  if (!reaction) return null
  return <img src={`/emojis/twemoji/${reaction.asset}.png`} alt={reaction.label} width={72} height={72} draggable={false} className={`${className} object-contain`} />
}
