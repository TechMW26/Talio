'use client'


import { Heading1 } from '@/components/ui/fernly/native'
import PerformanceAppraisalPanel from '@/components/performance/PerformanceAppraisalPanel'

export default function PerformanceAppraisalsPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 pb-24 md:px-6 md:pb-8">
      <header className="mb-6">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-sky-600 dark:text-sky-400">Performance</p>
        <Heading1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-zinc-100">Appraisal requests</Heading1>
        <p className="mt-1 text-sm text-slate-500 dark:text-zinc-400">Your assigned reviews, HR discussions, and submitted recommendations.</p>
      </header>
      <PerformanceAppraisalPanel />
    </main>
  )
}
