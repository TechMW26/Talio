'use client'

// Extracted so the HeroUI modal (and its react-aria dialog/focus/overlay stack)
// is not part of the initial dashboard bundle. It only renders when the user
// confirms a logout, so it is loaded on demand.
import { Button, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react'
import Modal from '@/components/ui/HeroModal'

export default function LogoutConfirmModal({ isOpen, onOpenChange, onConfirm }) {
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader className="bg-danger-500 text-white">Confirm Logout</ModalHeader>
            <ModalBody className="py-6">
              <p className="text-center text-default-700">
                Are you sure you want to logout?
              </p>
            </ModalBody>
            <ModalFooter className="justify-center">
              <Button variant="light" onPress={onClose}>
                Cancel
              </Button>
              <Button color="danger" onPress={onConfirm}>
                Logout
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  )
}
