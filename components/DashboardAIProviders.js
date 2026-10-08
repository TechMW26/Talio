'use client'

import dynamic from 'next/dynamic'
import { AILoadingProvider } from '@/contexts/AILoadingContext'
import { AIAssistantProvider } from '@/contexts/AIAssistantContext'
import { FocusTimerProvider } from '@/contexts/FocusTimerContext'
import { MiraChatProvider } from '@/contexts/MiraChatContext'
import { MeetingSessionProvider } from '@/contexts/MeetingSessionContext'
import { useCompanyFeatures } from '@/contexts/CompanyFeaturesContext'

// AI, MIRA and meeting state are used only inside the authenticated dashboard
// (Header, MiraChatSidebar, dashboard pages, meeting pages). Mounting them here
// instead of the root shell keeps their module graph out of public pages.
const GlobalAILoadingOverlay = dynamic(() => import('@/components/ui/GlobalAILoadingOverlay'), { ssr: false })
const MiraTransitionOverlay = dynamic(() => import('@/components/ui/MiraTransitionOverlay'), { ssr: false })
const MiraPermissionChecklist = dynamic(() => import('@/components/ui/MiraPermissionChecklist'), { ssr: false })
const AIAssistant = dynamic(() => import('@/components/AIAssistant'), { ssr: false })
const AIAssistantBridge = dynamic(() => import('@/components/AIAssistantBridge'), { ssr: false })

/**
 * MIRA is a plan feature. When the tenant's plan does not include it, none of the
 * MIRA providers, overlays or their chunks are loaded at all. Only the generic AI
 * loading context (used by in-page AI actions) and meeting state stay mounted.
 */
function MiraShell({ enabled, children }) {
  if (!enabled) {
    return (
      <MeetingSessionProvider>
        {children}
      </MeetingSessionProvider>
    )
  }
  return (
    <AIAssistantProvider>
      <MiraChatProvider>
        <MiraPermissionChecklist />
        <MiraTransitionOverlay />
        <AIAssistant />
        <AIAssistantBridge />
        <MeetingSessionProvider>
          {children}
        </MeetingSessionProvider>
      </MiraChatProvider>
    </AIAssistantProvider>
  )
}

export default function DashboardAIProviders({ children }) {
  const { features } = useCompanyFeatures()
  // Fail open until the feature payload arrives so MIRA is never hidden by a
  // slow or failed features request.
  const miraEnabled = features ? features.miraAI !== false : true

  return (
    <AILoadingProvider>
      <FocusTimerProvider>
        <GlobalAILoadingOverlay />
        <MiraShell enabled={miraEnabled}>
          {children}
        </MiraShell>
      </FocusTimerProvider>
    </AILoadingProvider>
  )
}
