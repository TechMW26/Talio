import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SWRConfig, useSWRConfig } from 'swr'
import WhiteboardDashboard from '@/components/whiteboard/WhiteboardDashboard'

test('returning to the page immediately renders cached boards without skeletons', async () => {
  const originalFetch = global.fetch
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ boards: [{ _id: '1', name: 'Cached board', isOwner: true }] }) })
  const cache = new Map()
  const config = { provider: () => cache, dedupingInterval: 60000 }
  const view = render(<SWRConfig value={config}><WhiteboardDashboard /></SWRConfig>)
  try {
    await screen.findByText('Cached board')
    view.rerender(<SWRConfig value={config}><span>Another page</span></SWRConfig>)
    view.rerender(<SWRConfig value={config}><WhiteboardDashboard /></SWRConfig>)
    expect(screen.getByText('Cached board')).toBeInTheDocument()
    expect(screen.queryByText(/Loading boards/)).not.toBeInTheDocument()
    expect(global.fetch).toHaveBeenCalledTimes(1)
  } finally {
    view.unmount()
    global.fetch = originalFetch
  }
})

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('@heroui/react', () => ({
  Button: ({ children, onPress, isDisabled }) => <button onClick={onPress} disabled={isDisabled}>{children}</button>,
}))
jest.mock('@/components/ui/ErrorBoundary', () => ({
  DataErrorState: ({ message, onRetry }) => <div role="alert">{message}<button onClick={onRetry}>Retry</button></div>,
}))

test('slow loads and background failures preserve usable controls, cached boards and drafts', async () => {
  const originalFetch = global.fetch
  let finishRead
  global.fetch = jest.fn(() => new Promise(resolve => { finishRead = resolve }))
  let refresh
  function Page() {
    refresh = useSWRConfig().mutate
    return <WhiteboardDashboard />
  }
  const view = render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><Page /></SWRConfig>)
  try {
    expect(screen.getByRole('status')).toHaveTextContent('Loading boards')
    expect(screen.queryByText('No boards yet')).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Search boards...'), { target: { value: 'Project' } })
    fireEvent.click(screen.getByText('New Board'))
    fireEvent.change(screen.getByPlaceholderText('Board name'), { target: { value: 'Unsaved draft' } })
    await act(async () => finishRead({ ok: true, status: 200, json: async () => ({ boards: [{ _id: '1', name: 'Project plan', isOwner: true }] }) }))
    expect(await screen.findByText('Project plan')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Board name')).toHaveValue('Unsaved draft')
    let pending
    act(() => { pending = refresh('/api/whiteboard') })
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2))
    expect(screen.getByText('Project plan')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Updating boards')
    await act(async () => {
      finishRead({ ok: false, status: 503, json: async () => ({ message: 'Temporarily unavailable' }) })
      await pending
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Temporarily unavailable')
    expect(screen.getByText('Project plan')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Board name')).toHaveValue('Unsaved draft')
  } finally {
    view.unmount()
    global.fetch = originalFetch
  }
})
