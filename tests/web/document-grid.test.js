import { render, screen, fireEvent } from '@testing-library/react'
import DocumentGrid from '@/components/employees/DocumentGrid'
jest.mock('@/components/employees/DocumentThumbnail', () => () => <span>Preview image</span>)
test('uses four desktop columns and wires preview, download and delete', () => {
  const doc = { _id: '1', name: 'Contract', category: 'employment' }
  const onPreview = jest.fn(), onDownload = jest.fn(), onDelete = jest.fn()
  render(<DocumentGrid documents={[doc]} onPreview={onPreview} onDownload={onDownload} onDelete={onDelete} />)
  expect(screen.getByLabelText('Documents grid').className).toContain('lg:grid-cols-4')
  expect(screen.getByLabelText('Documents grid')).toHaveClass('items-start')
  expect(screen.getByRole('button', { name: 'Preview Contract' })).not.toHaveClass('h-44')
  fireEvent.click(screen.getByRole('button', { name: 'Preview Contract' }))
  expect(onPreview).toHaveBeenCalledWith(doc)
  fireEvent.click(screen.getByRole('button', { name: 'Download Contract' }))
  expect(onDownload).toHaveBeenCalledWith(doc)
  fireEvent.click(screen.getByRole('button', { name: 'Delete Contract' }))
  expect(onDelete).toHaveBeenCalledWith('1')
})
test('preserves protected document deletion rules', () => {
  render(<DocumentGrid documents={[{ _id: '1', name: 'Identity', isAadhaarDocument: true }, { _id: '2', name: 'Letter', generatedLetter: true }]} />)
  expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument()
})
