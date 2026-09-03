'use client'

import { useEffect, useMemo, useState } from 'react'
import { Autocomplete, AutocompleteItem } from '@heroui/react'
import { HiOutlineMagnifyingGlass } from 'react-icons/hi2'

const asKey = (value) => value === null || value === undefined ? '' : String(value)

/**
 * Canonical searchable dropdown used across Talio forms.
 *
 * Keeping the displayed label controlled fixes the blank-value state that can
 * occur when async options arrive after a selected key. Search text is kept
 * separate from the persisted key, so users never accidentally save a label.
 */
export default function SearchableSelect({
  options = [],
  value,
  onValueChange,
  getOptionKey = (option) => option?.key ?? option?._id ?? option?.id,
  getOptionLabel = (option) => option?.label ?? option?.name ?? '',
  getOptionDescription,
  getOptionSearchText,
  renderOption,
  label,
  placeholder = 'Search and select',
  emptyContent = 'No matching options',
  isClearable = false,
  isLoading = false,
  isRequired = false,
  isDisabled = false,
  description,
  className,
  maxListboxHeight = 320,
  onOpenChange,
  classNames: providedClassNames = {},
  inputProps: providedInputProps = {},
  listboxProps: providedListboxProps = {},
  popoverProps: providedPopoverProps = {},
  ...props
}) {
  const normalizedOptions = useMemo(() => options.map((option) => {
    const key = asKey(getOptionKey(option))
    const optionLabel = String(getOptionLabel(option) || '')
    const optionDescription = getOptionDescription ? String(getOptionDescription(option) || '') : ''
    const searchText = getOptionSearchText
      ? String(getOptionSearchText(option) || '')
      : `${optionLabel} ${optionDescription}`
    return { key, label: optionLabel, description: optionDescription, searchText, option }
  }).filter((option) => option.key), [getOptionDescription, getOptionKey, getOptionLabel, getOptionSearchText, options])

  const selectedKey = asKey(value)
  const selectedOption = normalizedOptions.find((option) => option.key === selectedKey)
  const selectedLabel = selectedOption?.label || ''
  const [inputValue, setInputValue] = useState(selectedLabel)
  const [isOpen, setIsOpen] = useState(false)
  const visibleOptions = useMemo(() => {
    const query = inputValue.trim().toLocaleLowerCase()
    if (!query) return normalizedOptions

    return normalizedOptions.filter((option) => (
      `${option.label} ${option.description} ${option.searchText}`
        .toLocaleLowerCase()
        .includes(query)
    ))
  }, [inputValue, normalizedOptions])

  useEffect(() => {
    if (!isOpen) setInputValue(selectedLabel)
  }, [isOpen, selectedLabel])

  const handleOpenChange = (open) => {
    setIsOpen(open)
    if (!open) setInputValue(selectedLabel)
    onOpenChange?.(open)
  }

  const handleSelectionChange = (key) => {
    if (key === null || key === undefined) return
    const normalizedKey = asKey(key)
    const nextOption = normalizedOptions.find((option) => option.key === normalizedKey)
    setInputValue(nextOption?.label || '')
    setIsOpen(false)
    onValueChange?.(normalizedKey, nextOption?.option || null)
  }

  const handleClear = () => {
    setInputValue('')
    onValueChange?.('', null)
  }

  return (
    <Autocomplete
      {...props}
      className={className}
      classNames={{
        ...providedClassNames,
        base: `talio-searchable-select ${providedClassNames.base || ''}`.trim(),
        listboxWrapper: `p-1 ${providedClassNames.listboxWrapper || ''}`.trim(),
        listbox: `gap-1 ${providedClassNames.listbox || ''}`.trim(),
        popoverContent: `rounded-2xl border border-default-200 bg-content1 p-1 shadow-2xl ${providedClassNames.popoverContent || ''}`.trim(),
        selectorButton: `text-default-500 ${providedClassNames.selectorButton || ''}`.trim(),
      }}
      inputProps={{
        ...providedInputProps,
        classNames: {
          ...providedInputProps.classNames,
          inputWrapper: `min-h-12 bg-default-50 hover:bg-default-100 group-data-[focus=true]:bg-default-50 dark:bg-zinc-900 dark:hover:bg-zinc-800 ${providedInputProps.classNames?.inputWrapper || ''}`.trim(),
          input: `text-default-900 placeholder:text-default-400 ${providedInputProps.classNames?.input || ''}`.trim(),
          label: `text-default-600 ${providedInputProps.classNames?.label || ''}`.trim(),
          helperWrapper: `px-1 pt-1 ${providedInputProps.classNames?.helperWrapper || ''}`.trim(),
        },
      }}
      items={visibleOptions}
      label={label}
      labelPlacement="outside"
      placeholder={placeholder}
      description={description}
      selectedKey={selectedKey || null}
      inputValue={inputValue}
      onInputChange={(nextValue) => {
        setInputValue(nextValue)
        if (!isOpen) handleOpenChange(true)
      }}
      onSelectionChange={handleSelectionChange}
      isOpen={isOpen}
      onOpenChange={handleOpenChange}
      isClearable={isClearable}
      onClear={isClearable ? handleClear : undefined}
      isLoading={isLoading}
      isRequired={isRequired}
      isDisabled={isDisabled}
      allowsCustomValue={false}
      startContent={<HiOutlineMagnifyingGlass className="h-5 w-5 shrink-0 text-default-400" aria-hidden="true" />}
      maxListboxHeight={maxListboxHeight}
      listboxProps={{ ...providedListboxProps, emptyContent: providedListboxProps.emptyContent || emptyContent }}
      popoverProps={{ placement: 'bottom', offset: 6, shouldFlip: true, ...providedPopoverProps }}
    >
      {(item) => (
        <AutocompleteItem
          key={item.key}
          textValue={`${item.label} ${item.searchText}`.trim()}
          className="rounded-xl px-3 py-2.5 text-default-800 data-[hover=true]:bg-default-100 data-[selected=true]:bg-primary-50 data-[selected=true]:text-primary"
        >
          {renderOption ? renderOption(item.option) : (
            <div className="min-w-0">
              <span className="block truncate text-sm font-medium">{item.label}</span>
              {item.description && <span className="mt-0.5 block truncate text-xs text-default-500">{item.description}</span>}
            </div>
          )}
        </AutocompleteItem>
      )}
    </Autocomplete>
  )
}
