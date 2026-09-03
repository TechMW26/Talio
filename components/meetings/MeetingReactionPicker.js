'use client'

import { Popover, PopoverContent, PopoverTrigger } from '@heroui/react'
import { BsEmojiSmile } from 'react-icons/bs'
import { MEETING_REACTIONS, MeetingReactionIcon } from '@/components/meetings/MeetingVisualIcons'

export default function MeetingReactionPicker({
  isOpen,
  onOpenChange,
  onSelect,
  buttonClassName = '',
  iconClassName = 'h-5 w-5',
}) {
  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      placement="top"
      offset={10}
      shouldFlip
      classNames={{
        base: 'z-[220]',
        content: 'rounded-2xl border border-slate-200 bg-white p-0 shadow-2xl dark:border-white/15 dark:bg-slate-800',
      }}
    >
      <PopoverTrigger>
        <button
          type="button"
          aria-label={isOpen ? 'Close reactions' : 'Open reactions'}
          title="Reactions"
          className={buttonClassName}
        >
          <BsEmojiSmile className={iconClassName} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent>
        <div className="flex gap-1 p-2" data-meeting-reaction-picker role="group" aria-label="Meeting reactions">
          {MEETING_REACTIONS.map((reaction) => (
            <button
              type="button"
              key={reaction.value}
              onClick={() => onSelect?.(reaction.value)}
              aria-label={`React with ${reaction.label}`}
              title={reaction.label}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-indigo-600 transition hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:text-indigo-300 dark:hover:bg-white/10"
            >
              <MeetingReactionIcon value={reaction.value} className="h-6 w-6" />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
