'use client'

import { useRef, useState } from 'react'
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Heading2, NativeInput } from '@/components/ui/fernly'
import { DEFAULT_PHOTO_VIEWPORT, photoViewportStyle } from '@/lib/profilePhotoViewport'
import styles from './ProfilePhotoEditor.module.css'

const controls = [['scale', 'Zoom', .5, 3, .05], ['rotation', 'Rotation', 0, 360, 1], ['brightness', 'Brightness', 50, 150, 1], ['contrast', 'Contrast', 50, 150, 1], ['saturation', 'Saturation', 0, 200, 1]]
export default function ProfilePhotoEditor({ isOpen, image, viewport, onChange, onClose, onSave, busy }) {
  const drag = useRef(null)
  const [loadedImage, setLoadedImage] = useState(null)
  const [failedImage, setFailedImage] = useState(null)
  const change = (key, value) => onChange({ ...viewport, [key]: value })
  const begin = event => {
    if (busy) return
    const size = event.currentTarget.getBoundingClientRect().width
    drag.current = { x: event.clientX, y: event.clientY, origin: viewport, size }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const move = event => {
    if (!drag.current) return
    const { x, y, origin, size } = drag.current
    onChange({ ...viewport, x: Math.max(-100, Math.min(100, origin.x + (event.clientX - x) / size * 100)), y: Math.max(-100, Math.min(100, origin.y + (event.clientY - y) / size * 100)) })
  }
  return <Modal isOpen={isOpen} onClose={busy ? undefined : onClose} isDismissable={!busy} isKeyboardDismissDisabled={busy} hideCloseButton={busy} size="4xl" scrollBehavior="inside" classNames={{ wrapper: 'z-[99999]' }}>
    <ModalContent>
      <ModalHeader className={styles.header}><Heading2>Frame your profile photo</Heading2><p>Your original image stays intact. These settings only change its avatar viewport.</p></ModalHeader>
      <ModalBody className={styles.body}>
        <div className={styles.previews}>
          <div className={styles.stage}><div className={styles.viewport} role="group" aria-label="Avatar viewport" onPointerDown={begin} onPointerMove={move} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}>
            <img src={image || undefined} alt="Avatar framing preview" draggable={false} style={photoViewportStyle(viewport)} onLoad={() => setLoadedImage(image)} onError={() => setFailedImage(image)} />
          </div><p>Drag to position · Adjust with the controls below</p></div>
          <div className={styles.original}><img src={image || undefined} alt="Full original image — unchanged" /><p>Full image · no crop or mask</p></div>
        </div>
        {failedImage === image && image && <p role="alert">Unable to preview this image. Choose another PNG, JPEG, WebP or GIF.</p>}
        <fieldset className={styles.controls} disabled={busy}>
          {controls.map(([key, label, min, max, step]) => <label key={key} htmlFor={`photo-${key}`}><span>{label}<output>{key === 'scale' ? `${Math.round(viewport[key] * 100)}%` : key === 'rotation' ? `${viewport[key]}°` : `${viewport[key]}%`}</output></span><NativeInput id={`photo-${key}`} aria-label={label} type="range" min={min} max={max} step={step} value={viewport[key]} onChange={event => change(key, Number(event.target.value))} /></label>)}
          {['x', 'y'].map(key => <label key={key} htmlFor={`photo-${key}`}><span>{key === 'x' ? 'Horizontal position' : 'Vertical position'}<output>{Math.round(viewport[key])}%</output></span><NativeInput id={`photo-${key}`} aria-label={key === 'x' ? 'Horizontal position' : 'Vertical position'} type="range" min="-100" max="100" value={viewport[key]} onChange={event => change(key, Number(event.target.value))} /></label>)}
        </fieldset>
      </ModalBody>
      <ModalFooter className={styles.footer}><Button variant="light" onPress={() => onChange({ ...DEFAULT_PHOTO_VIEWPORT })} isDisabled={busy}>Reset framing</Button><Button variant="bordered" onPress={onClose} isDisabled={busy}>Cancel</Button><Button color="primary" onPress={onSave} isLoading={busy} isDisabled={busy || loadedImage !== image || failedImage === image}>Save photo</Button></ModalFooter>
    </ModalContent>
  </Modal>
}
