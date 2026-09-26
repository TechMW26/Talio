import { render, screen, fireEvent } from '@testing-library/react'
import AssetTrackingFields from '@/components/assets/AssetTrackingFields'
import { ASSET_TRACKER_FIELDS, assetTrackerValue, formatAssetStatus } from '@/utils/assetData'

jest.mock('@heroui/react', () => ({
  Input: ({ label, ...props }) => <label>{label}<input {...props} /></label>,
  Textarea: ({ label, ...props }) => <label>{label}<textarea {...props} /></label>,
  Select: ({ label, selectedKeys, onSelectionChange, children }) => <label>{label}<select value={selectedKeys[0]} onChange={event => onSelectionChange(new Set([event.target.value]))}>{children}</select></label>,
  SelectItem: ({ children }) => <option value={children === 'Yes' ? 'yes' : children === 'No' ? 'no' : 'unknown'}>{children}</option>,
}))

test('renders every supplemental tracker field and preserves tri-state accessories', () => {
  const onChange = jest.fn()
  render(<AssetTrackingFields values={{ box: false, charger: null, billNumber: '0012' }} onChange={onChange} />)
  for (const [key, label] of ASSET_TRACKER_FIELDS) {
    if (!['name', 'status', 'assignedTo'].includes(key)) expect(screen.getByLabelText(label)).toBeInTheDocument()
  }
  expect(screen.getByLabelText('Bill Number').value).toBe('0012')
  expect(screen.getByLabelText('Box').value).toBe('no')
  expect(screen.getByLabelText('Charger').value).toBe('unknown')
  fireEvent.change(screen.getByLabelText('Charger'), { target: { value: 'yes' } })
  expect(onChange).toHaveBeenLastCalledWith({ target: { name: 'charger', value: true } })
})

test('tracker displays requested status labels and false is not confused with missing data', () => {
  expect(ASSET_TRACKER_FIELDS).toHaveLength(19)
  expect(formatAssetStatus('available')).toBe('In Stock')
  expect(formatAssetStatus('returned')).toBe('Return')
  expect(formatAssetStatus('not-working')).toBe('Not Working')
  expect(formatAssetStatus('not-match')).toBe('Not Match')
  expect(assetTrackerValue({ box: false }, 'box', 'boolean')).toBe('No')
  expect(assetTrackerValue({}, 'box', 'boolean')).toBe('Not recorded')
})
