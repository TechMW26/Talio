'use client'

import { Toaster, ToastBar, toast } from 'react-hot-toast'
import { FaTimes } from 'react-icons/fa'

export default function NotificationToaster() {
  return <Toaster position="top-right" containerStyle={{ zIndex: 999999 }} toastOptions={{
    className: 'talio-feedback-toast',
    style: { fontSize: '14px', padding: '14px 18px', maxWidth: '420px' },
  }}>
    {item => <ToastBar toast={item}>{({ icon, message }) => <>
      {icon}{message}
      <button type="button" className="notice-close" aria-label="Dismiss message" onClick={() => toast.dismiss(item.id)}><FaTimes className="h-4 w-4" /></button>
    </>}</ToastBar>}
  </Toaster>
}
