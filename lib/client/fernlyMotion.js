// Short compositor-only pop; no spring, travel or animated backdrop filters.
export const fernlyDialogMotion = {
  variants: {
    enter: { opacity: 1, y: 0, scale: 1, transition: { duration: .18, ease: [.2, .8, .2, 1] } },
    exit: { opacity: 0, y: 0, scale: .96, transition: { duration: .12, ease: 'easeOut' } },
  },
}

export const fernlyPopoverMotion = {
  variants: {
    ...fernlyDialogMotion.variants,
    initial: { opacity: 0, y: 0, scale: .96 },
  },
}
