'use client'

export default function MeetingRoomRoute() {
  return (
    <div
      className="fixed inset-0 z-[100] flex h-[100dvh] w-screen items-center justify-center bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-white"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-4">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-300 border-t-indigo-500 dark:border-white/20 dark:border-t-indigo-400" />
        <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Loading Talio Meet…</p>
      </div>
    </div>
  )
}
