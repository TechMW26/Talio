'use client'
import { useState } from 'react'
import { Skeleton, LoadingReveal } from '@/components/ui/AsciiLoading'
import Modal from '@/components/ui/Modal'
import HeroModal from '@/components/ui/HeroModal'
import { ModalContent, ModalHeader, ModalBody } from '@heroui/react'
// Local-only visual QA fixture; never exposed as an application route.
export default function AsciiLoadingPreview() {
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [hero, setHero] = useState(false)
  return <main style={{ padding: 24, maxWidth: 900, margin: 'auto' }}>
    <h1>Talio loading and popup QA</h1>
    <div className="flex flex-wrap gap-4 my-6">
      <button onClick={() => setLoading(true)}>Show loading</button>
      <button onClick={() => setLoading(false)}>Show content</button>
      <button onClick={() => setOpen(true)}>Open custom popup</button>
      <button onClick={() => setHero(true)}>Open shared popup</button>
    </div>
    <section className="rounded-2xl border border-default-200 p-6 space-y-4">
      <input aria-label="Draft" placeholder="Keep this draft" />
      {loading ? <><Skeleton className="h-8 w-2/3 rounded-lg" /><Skeleton className="h-40 w-full rounded-xl" /><Skeleton className="h-4 w-full rounded" /><Skeleton className="h-4 w-3/4 rounded" /></> : <><h2>Ready for the day</h2><p>Your tasks and team updates are ready. The draft stays exactly where you left it.</p></>}
    </section>
    <LoadingReveal loading={loading} className="mt-6 p-6 rounded-2xl border border-default-200">
      {loading ? <Skeleton className="h-16 w-full rounded-lg" /> : <p>Explicit terminal reveal boundary</p>}
    </LoadingReveal>
    <Modal isOpen={open} onClose={() => setOpen(false)} title="Custom popup"><p>Quick pop with no blur animation.</p><input aria-label="Popup draft" /></Modal>
    <HeroModal isOpen={hero} onClose={() => setHero(false)}><ModalContent><ModalHeader>Shared popup</ModalHeader><ModalBody><p>Keyboard focus and dismissal remain available.</p><input aria-label="Shared draft" /></ModalBody></ModalContent></HeroModal>
  </main>
}
