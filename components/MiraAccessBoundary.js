'use client'
import { useCompanyFeatures } from '@/contexts/CompanyFeaturesContext'

// Do not mount microphone owners (even a hidden sidebar) without fresh access.
// Losing access unmounts the call and wake engines, whose cleanup stops tracks.
export default function MiraAccessBoundary({ children }) {
  const { features, miraAccess } = useCompanyFeatures()
  return features && features.miraAI !== false && miraAccess?.allowed === true ? children : null
}
