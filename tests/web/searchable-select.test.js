import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import SearchableSelect from '@/components/ui/heroui/SearchableSelect'

jest.mock('@heroui/react', () => ({
  Autocomplete: ({ items = [], inputValue, onInputChange, onSelectionChange, label, placeholder }) => (
    <div>
      <label htmlFor="searchable-select-test">{label}</label>
      <input
        id="searchable-select-test"
        aria-label={label}
        placeholder={placeholder}
        value={inputValue}
        onChange={(event) => onInputChange(event.target.value)}
      />
      {Array.from(items).map((item) => (
        <button type="button" key={item.key} onClick={() => onSelectionChange(item.key)}>
          {item.label}
        </button>
      ))}
    </div>
  ),
  AutocompleteItem: ({ children }) => children,
}))

describe('SearchableSelect', () => {
  const people = [
    { id: 7, name: 'Aviraj Sharma' },
    { id: 9, name: 'Sahil Sahu' },
  ]

  test('restores the selected label when asynchronous options arrive', async () => {
    const { rerender } = render(
      <SearchableSelect label="Assigned To" options={[]} value="7" onValueChange={() => {}} />
    )

    expect(screen.getByLabelText('Assigned To')).toHaveValue('')

    rerender(
      <SearchableSelect label="Assigned To" options={people} value="7" onValueChange={() => {}} />
    )

    await waitFor(() => expect(screen.getByLabelText('Assigned To')).toHaveValue('Aviraj Sharma'))
  })

  test('persists a normalized key while displaying the selected label', async () => {
    const onValueChange = jest.fn()
    function ControlledSelect() {
      const [value, setValue] = useState('')
      return (
        <SearchableSelect
          label="Assigned To"
          options={people}
          value={value}
          onValueChange={(key, option) => {
            setValue(key)
            onValueChange(key, option)
          }}
        />
      )
    }

    render(<ControlledSelect />)

    fireEvent.change(screen.getByLabelText('Assigned To'), { target: { value: 'sah' } })
    expect(screen.getByLabelText('Assigned To')).toHaveValue('sah')
    expect(screen.queryByRole('button', { name: 'Aviraj Sharma' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Sahil Sahu' }))

    expect(onValueChange).toHaveBeenCalledWith('9', people[1])
    await waitFor(() => expect(screen.getByLabelText('Assigned To')).toHaveValue('Sahil Sahu'))
  })
})
