'use client'
import { useEffect, useState } from 'react'

export function workedTime(attendance, now) {
  if (!attendance?.checkIn) return '--:--'
  const start = new Date(attendance.checkIn).getTime()
  const end = attendance.checkOut ? new Date(attendance.checkOut).getTime() : now
  const hours = attendance.workHours
  const minutes = attendance.checkOut && typeof hours === 'number' && Number.isFinite(hours)
    ? Math.round(hours * 60) : Math.floor((end - start) / 60000)
  if (!Number.isFinite(minutes)) return '--:--'
  const safe = Math.max(0, minutes)
  return `${Math.floor(safe / 60)}h ${safe % 60}m`
}

export default function AttendanceHeaderSummary({ todayAttendance, remainingTime, isCountingDown, formatCountdown }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    if (!todayAttendance?.checkIn || todayAttendance?.checkOut) return
    const timer = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(timer)
  }, [todayAttendance?.checkIn, todayAttendance?.checkOut])
  return <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-default-500" aria-label="Today's work hours">
    <span>Work hours <strong className="ml-1.5 font-semibold tabular-nums text-foreground">{workedTime(todayAttendance, now)}</strong></span>
    {isCountingDown && <span>Remaining <strong className="ml-1.5 font-semibold tabular-nums text-emerald-400">{formatCountdown(remainingTime)}</strong></span>}
  </div>
}
