'use client'

import { useEffect, useState } from 'react'

export default function MemberAvatar({
  member,
  className = 'h-9 w-9',
  textClassName = 'text-xs',
  background = 'linear-gradient(135deg, #3B82F6, #2563EB)',
}) {
  const [imageFailed, setImageFailed] = useState(false)
  const imageUrl = member?.profilePicture
  const name = `${member?.firstName || ''} ${member?.lastName || ''}`.trim() || 'Member'
  const initials = `${member?.firstName?.[0] || ''}${member?.lastName?.[0] || ''}`.toUpperCase() || '?'

  useEffect(() => {
    setImageFailed(false)
  }, [imageUrl])

  return (
    <div
      className={`${className} flex flex-shrink-0 items-center justify-center overflow-hidden rounded-full`}
      style={{ background }}
      aria-label={name}
    >
      {imageUrl && !imageFailed ? (
        <img
          src={imageUrl}
          alt={`${name} profile`}
          className="h-full w-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span className={`${textClassName} font-semibold text-white`} aria-hidden="true">
          {initials}
        </span>
      )}
    </div>
  )
}
