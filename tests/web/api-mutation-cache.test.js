import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import useSWR, { SWRConfig } from 'swr'
import useApiMutation from '@/hooks/useApiMutation'

test('writes revalidate the active provider and filtered list without clearing form state', async () => {
  let finishRead
  const read = jest.fn().mockResolvedValueOnce({ name: 'Before' }).mockImplementation(() => new Promise(resolve => { finishRead = resolve }))
  const previousFetch = global.fetch
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) })
  function Editor() {
    const [draft, setDraft] = useState('')
    return <input aria-label="Draft" value={draft} onChange={e => setDraft(e.target.value)} />
  }
  function Page() {
    const { data } = useSWR('/api/projects?status=active', read)
    const { execute } = useApiMutation({ invalidateKeys: ['/api/projects'] })
    return <><button onClick={() => execute('/api/projects/1', {})}>Save</button>{data ? <><span>{data.name}</span><Editor /></> : <span>Loading</span>}</>
  }
  const view = render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><Page /></SWRConfig>)
  try {
    await screen.findByText('Before')
    fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'AI generated summary' } })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    expect(screen.getByText('Before')).toBeInTheDocument()
    expect(screen.getByLabelText('Draft')).toHaveValue('AI generated summary')
    await act(async () => finishRead({ name: 'After' }))
    expect(await screen.findByText('After')).toBeInTheDocument()
    expect(screen.getByLabelText('Draft')).toHaveValue('AI generated summary')
  } finally {
    view.unmount()
    global.fetch = previousFetch
  }
})
