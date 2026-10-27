'use client'

import { forwardRef } from 'react'
import { useReducedMotion } from 'framer-motion'
import { Popover as HeroPopover, Dropdown as HeroDropdown, Select as HeroSelect, Autocomplete as HeroAutocomplete } from '@heroui/react'
import { fernlyPopoverMotion } from '@/lib/client/fernlyMotion'

function popup(Component, nested = false) {
  return forwardRef(function PopupMotion(props, ref) {
    const reduced = useReducedMotion()
    const source = nested ? props.popoverProps || {} : props
    const motion = {
      ...source,
      disableAnimation: reduced || source.disableAnimation,
      motionProps: { ...source.motionProps, ...fernlyPopoverMotion },
    }
    return <Component {...props} {...(nested ? { popoverProps: motion } : motion)} ref={ref} />
  })
}

export const Popover = popup(HeroPopover)
export const Dropdown = popup(HeroDropdown)
export const Select = popup(HeroSelect, true)
export const Autocomplete = popup(HeroAutocomplete, true)
