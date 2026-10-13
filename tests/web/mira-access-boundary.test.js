import React, { useEffect } from 'react'
import { render, screen } from '@testing-library/react'
import MiraAccessBoundary from '@/components/MiraAccessBoundary'
let mockAccess, mockFeatures
jest.mock('@/contexts/CompanyFeaturesContext', () => ({ useCompanyFeatures: () => ({ features: mockFeatures, miraAccess: mockAccess }) }))
test('disabled or unverified Mira never starts mic owners; revocation unmounts and stops them', () => {
  const start = jest.fn(), stop = jest.fn()
  const MicrophoneOwner = () => { useEffect(() => { start(); return stop }, []); return <span>Microphone owner</span> }
  const tree = <MiraAccessBoundary><MicrophoneOwner /></MiraAccessBoundary>
  mockFeatures = { miraAI: true }; mockAccess = null
  const { rerender } = render(tree)
  expect(start).not.toHaveBeenCalled()
  mockAccess = { allowed: false, level: 9 }; rerender(<MiraAccessBoundary><MicrophoneOwner /></MiraAccessBoundary>)
  expect(start).not.toHaveBeenCalled()
  mockAccess = { allowed: true, level: 9 }; rerender(<MiraAccessBoundary><MicrophoneOwner /></MiraAccessBoundary>)
  expect(screen.getByText('Microphone owner')).toBeInTheDocument()
  expect(start).toHaveBeenCalledTimes(1)
  mockAccess = { allowed: false, level: 9 }; rerender(<MiraAccessBoundary><MicrophoneOwner /></MiraAccessBoundary>)
  expect(stop).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('Microphone owner')).toBeNull()
  mockFeatures = { miraAI: false }; mockAccess = { allowed: true }; rerender(<MiraAccessBoundary><MicrophoneOwner /></MiraAccessBoundary>)
  expect(start).toHaveBeenCalledTimes(1)
})
