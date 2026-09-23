import { fireEvent, render, screen } from '@testing-library/react'
import Editor from '@/app/dashboard/talioboard/[id]/page'
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }), useParams: () => ({ id: 'board1' }) }))
const mockBoardResponse = { data: { whiteboard: { _id: 'board1', title: 'Test board' }, permission: 'owner' }, mutate: jest.fn() }
jest.mock('@/hooks/useAuthedSWR', () => ({ __esModule: true, default: () => mockBoardResponse }))
jest.mock('@/components/whiteboard/WhiteboardCanvas', () => ({ __esModule: true, default: () => <div>Canvas</div> }))
jest.mock('@heroui/react', () => ({ Skeleton: () => <span>Loading</span> }))

test('fills the viewport without browser permission, and only requests native fullscreen on explicit interaction', () => {
  const request = jest.fn().mockResolvedValue(undefined)
  document.documentElement.requestFullscreen = request
  const view = render(<Editor />)
  try {
    const editor = screen.getByTestId('board-fullscreen-editor')
    expect(editor.parentElement).toBe(document.body)
    expect(editor).toHaveClass('fixed', 'inset-0', 'h-[100dvh]')
    expect(request).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTitle('Enter Fullscreen'))
    expect(request).toHaveBeenCalledTimes(1)
  } finally {
    view.unmount()
    delete document.documentElement.requestFullscreen
  }
})
