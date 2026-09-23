'use client'

import { BotAvatar } from 'bot-avatars'

export default function MiraPet({ size = 40, isThinking = false }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center align-middle" style={{ width: size, height: size }}>
      <BotAvatar
        type="circle"
        face="mouth"
        color="#ffffff"
        ink="#101820"
        size={size}
        state={isThinking ? 'working' : 'default'}
        shading="plastic"
        theme="auto"
        aria-label={isThinking ? 'MIRA thinking' : 'MIRA'}
      />
    </span>
  )
}
