import { act, render, screen, waitFor } from '@testing-library/react'
import toast from '@/utils/toast'
import AIAssistantBridge from '@/components/AIAssistantBridge'
import { AIAssistantProvider, useAIAssistant } from '@/contexts/AIAssistantContext'

jest.mock('@/utils/toast', () => {
  const mockToast = { error: jest.fn() }
  return { __esModule: true, default: mockToast }
})

function StateProbe() {
  const { isOpen, errorContext } = useAIAssistant()
  return (
    <output data-testid="assistant-state">
      {JSON.stringify({ isOpen, errorContext })}
    </output>
  )
}

function renderAssistant(children = null) {
  return render(
    <AIAssistantProvider>
      {children}
      <StateProbe />
      <AIAssistantBridge />
    </AIAssistantProvider>
  )
}

function readState() {
  return JSON.parse(screen.getByTestId('assistant-state').textContent)
}

describe('Mira popup guidance bridge', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ success: true, response: 'Try the action again.' }),
    })
  })

  afterEach(() => {
    delete global.fetch
  })

  test('opens Mira for an actionable failure inside a popup and includes its title', async () => {
    renderAssistant(
      <section role="dialog" aria-modal="true">
        <h2>Attendance regularisation</h2>
      </section>
    )

    act(() => {
      toast.error('Failed to update correction')
    })

    await waitFor(() => expect(readState().isOpen).toBe(true))
    expect(readState().errorContext).toEqual(expect.objectContaining({
      message: 'Failed to update correction',
      action: 'popup_error',
      surface: 'popup',
      popupTitle: 'Attendance regularisation',
    }))
    expect(global.fetch).toHaveBeenCalledWith('/api/ai/assistant', expect.objectContaining({ method: 'POST' }))
  })

  test('opens Mira for common unable-to-complete wording outside a popup', async () => {
    renderAssistant()

    act(() => {
      toast.error('Unable to verify this onboarding step')
    })

    await waitFor(() => expect(readState().isOpen).toBe(true))
    expect(readState().errorContext).toEqual(expect.objectContaining({
      action: 'toast_error',
      message: 'Unable to verify this onboarding step',
    }))
    expect(readState().errorContext).not.toHaveProperty('popupTitle')
  })

  test('does not interrupt the user for ordinary field validation', () => {
    renderAssistant(
      <section role="dialog" aria-modal="true">
        <h2>Create task</h2>
      </section>
    )

    act(() => {
      toast.error('Please select at least one assignee')
    })

    expect(readState()).toEqual({ isOpen: false, errorContext: null })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
