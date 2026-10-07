'use client'

// Fernly visual language, with Talio's existing accessible interaction engine.
// Collection children (Tab, SelectItem, TableColumn, etc.) stay unwrapped so
// React Aria can continue discovering their collection metadata.
import { element } from './native'
import { forwardRef } from 'react'
import { Button as HeroButton, Card as HeroCard, Input as HeroInput, Textarea as HeroTextarea, Select as HeroSelect, Autocomplete as HeroAutocomplete, Chip as HeroChip, Tabs as HeroTabs, Table as HeroTable, PopoverContent as HeroPopoverContent, DropdownMenu as HeroDropdownMenu } from '@heroui/react'
import TalioModal from '../HeroModal'


export { Accordion, AccordionItem, Avatar, AutocompleteItem, CardBody, CardFooter, CardHeader, Checkbox, Divider, ModalBody, ModalContent, ModalFooter, ModalHeader, Pagination, Progress, Radio, RadioGroup, ScrollShadow, SelectItem, Skeleton, Spinner, Switch, Tab, TableHeader, TableBody, TableColumn, TableRow, TableCell, Tooltip, useDisclosure } from '@heroui/react'

export const Button = element(HeroButton, 'button')
export const Card = element(HeroCard, 'card')
export const Input = element(HeroInput, 'field', { inputWrapper: 'control', label: 'label' })
export const Textarea = element(HeroTextarea, 'field', { inputWrapper: 'control', label: 'label' })
export const Select = element(HeroSelect, 'field', { trigger: 'control', label: 'label', popoverContent: 'popover' })
export const Autocomplete = element(HeroAutocomplete, 'field', { popoverContent: 'popover' })
export const Chip = element(HeroChip, 'chip')
const StyledTabs = element(HeroTabs, 'tabs', { tabList: 'tabList', cursor: 'tabCursor', tab: 'tab', tabContent: 'tabContent' })
// One solid sliding-pill treatment across all shared tab selectors.
export const Tabs = forwardRef(function FernlyTabs(props, ref) {
  return <StyledTabs {...props} ref={ref} variant="solid" color="primary" radius="full" />
})
export const Table = element(HeroTable, 'table', { wrapper: 'card' })
export const Modal = element(TalioModal, 'dialog', { base: 'dialog' })
export const PopoverContent = element(HeroPopoverContent, 'popover')
export const DropdownMenu = element(HeroDropdownMenu, 'popover')

export { NativeButton, NativeInput, NativeSelect, NativeTextarea, Surface, NativeTable, DialogSurface, Heading1, Heading2, Heading3 } from './native'
export { default as SummaryCard } from './SummaryCard'
