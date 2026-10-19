'use client'

import { memo, useRef } from 'react'
import { RobotHead } from 'robot-heads'
import useMiraOrbState from '@/hooks/useMiraOrbState'
import useMiraRobotState from '@/hooks/useMiraRobotState'
import { miraRobotState, MIRA_ROBOT_COLORS } from '@/lib/miraRobotState'

// Keep one canvas mounted so pose easing and face transitions remain continuous.
export default memo(function MiraPet({ size = 40, isThinking = false, state, speed = 1, paused = false }) {
  const activity = useMiraOrbState()
  const canvas = useRef(null)
  const phase = state || (activity !== 'breathing' ? activity : isThinking ? 'solving' : 'breathing')
  const expression = useMiraRobotState(miraRobotState(phase), canvas)
  return <span data-mira-orb-state={phase} data-mira-robot-state={expression} className="inline-flex shrink-0 items-center justify-center align-middle" style={{ width: size, height: size, background: 'transparent' }}>
    <RobotHead ref={canvas} shape="circle" state={expression} size={size}
      {...MIRA_ROBOT_COLORS} antenna={false} floorShadow={false}
      interactive speed={speed} paused={paused} aria-label={`Mira ${expression}`} />
  </span>
})
