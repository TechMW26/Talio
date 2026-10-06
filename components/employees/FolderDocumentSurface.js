'use client'

import { useCallback, useEffect, useRef } from 'react'
import { ModalContent, ModalHeader, ModalBody } from '@/components/ui/fernly'
import { Modal as Modal } from '@/components/ui/fernly'
import DocumentGrid from './DocumentGrid'
import styles from './FolderDocumentSurface.module.css'
import { folderGenieFrames } from '@/lib/client/folderGenie'

export default function FolderDocumentSurface({ folder, sourceElement, onClose, ...gridProps }) {
  const host = useRef(null)
  const animations = useRef([])
  const blurAnimation = useRef(null)
  const closing = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      animations.current.forEach(animation => animation.cancel())
      blurAnimation.current?.cancel()
    }
  }, [])

  const fadeBlur = useCallback(async visible => {
    const backdrop = document.querySelector(`.${styles.backdrop}`)
    if (!backdrop) return
    const opacity = visible ? '0' : getComputedStyle(backdrop).opacity || '0'
    blurAnimation.current?.cancel()
    backdrop.style.opacity = visible ? '1' : '0'
    if (!backdrop.animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const animation = backdrop.animate([{ opacity }, { opacity: visible ? 1 : 0 }], {
      duration: 400,
      delay: 0,
      easing: 'ease-in-out',
      fill: 'both',
    })
    blurAnimation.current = animation
    await animation.finished.catch(() => {})
    if (blurAnimation.current === animation) {
      animation.cancel()
      blurAnimation.current = null
    }
  }, [])

  const animate = useCallback(reverse => {
    animations.current.forEach(animation => animation.cancel())
    animations.current = []
    const source = sourceElement?.getBoundingClientRect()
    if (!source || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return Promise.resolve()
    // Batch layout reads before starting any animations.
    const cards = [...(host.current?.querySelectorAll('article') || [])]
      .map(card => ({ card, target: card.getBoundingClientRect() }))
    cards.forEach(({ card, target }) => {
      // Offscreen rows should not incur animation work or fly through the viewport.
      if (!card.animate || target.top > window.innerHeight || target.bottom < 0) return
      const animation = card.animate(folderGenieFrames(source, target), {
        duration: reverse ? 500 : 400,
        delay: 0,
        direction: reverse ? 'reverse' : 'normal',
        easing: 'cubic-bezier(.22,.7,.25,1)',
        fill: 'both',
      })
      animations.current.push(animation)
    })
    return Promise.all(animations.current.map(animation => animation.finished.catch(() => {})))
  }, [sourceElement])

  const attach = useCallback(node => {
    host.current = node
    if (node) void Promise.all([animate(false), fadeBlur(true)]).then(() => {
      if (!alive.current || closing.current) return
      animations.current.forEach(animation => animation.cancel())
    })
  }, [animate, fadeBlur])
  const close = async () => {
    if (closing.current) return
    closing.current = true
    if (host.current) host.current.inert = true
    animations.current.forEach(animation => animation.cancel())
    await Promise.all([fadeBlur(false), animate(true)])
    if (alive.current) onClose()
  }

  return <Modal isOpen onClose={close} size="full" backdrop="blur" scrollBehavior="inside" disableAnimation
    classNames={{ base: `${styles.surface} !bg-transparent !shadow-none !border-0 !rounded-none`, backdrop: `${styles.backdrop} !bg-transparent backdrop-blur-xl`, header: 'px-6 sm:px-10 pt-8 pr-24 text-white', body: 'px-6 sm:px-10 pt-6 pb-12', closeButton: '!top-6 !right-6 text-white bg-black/40' }}>
    <ModalContent>
      <ModalHeader>{folder.name} — Documents</ModalHeader>
      <ModalBody>
        <div ref={attach}>
          {folder.documents.length ? <DocumentGrid documents={folder.documents} {...gridProps} columns={5} /> : <p className="py-24 text-center text-white/80">No documents in this folder yet.</p>}
        </div>
      </ModalBody>
    </ModalContent>
  </Modal>
}
