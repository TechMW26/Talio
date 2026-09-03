'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react'
import { HiOutlineExclamationTriangle, HiOutlinePlayCircle } from 'react-icons/hi2'
import { useMeetingSession } from '@/contexts/MeetingSessionContext'

export default function MeetingJoinLink({ roomId, children, className = '' }) {
  const meetingSession = useMeetingSession()
  const [showConflict, setShowConflict] = useState(false)
  const hasConflict = Boolean(
    meetingSession?.isJoined
    && meetingSession?.activeRoomId
    && meetingSession.activeRoomId !== roomId
  )

  const handleClick = (event) => {
    if (!hasConflict) return
    event.preventDefault()
    setShowConflict(true)
  }

  return (
    <>
      <Link
        href={`/dashboard/meetings/room/${roomId}`}
        onClick={handleClick}
        className={className}
      >
        {children}
      </Link>

      <Modal isOpen={showConflict} onOpenChange={setShowConflict} size="md">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                  <HiOutlineExclamationTriangle className="h-5 w-5" />
                </span>
                One meeting at a time
              </ModalHeader>
              <ModalBody>
                <p className="text-sm leading-6 text-default-600">
                  You are already connected to another meeting. Leave that meeting before joining this one.
                </p>
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={onClose}>Stay here</Button>
                <Button
                  color="primary"
                  startContent={<HiOutlinePlayCircle className="h-4 w-4" />}
                  onPress={() => {
                    onClose()
                    meetingSession.restoreMeeting()
                  }}
                >
                  Return to meeting
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  )
}
