'use client'

import { Surface, NativeButton } from './native'
import styles from './elements.module.css'

// Keep summary values and labels plain: colour belongs to status chips and
// data visualisations, not one-off card borders, gradients or heading icons.
export default function SummaryCard({ label, value, children, className = '', shadow, radius, isHoverable, isPressable, onPress, onClick, isDisabled, as, ...props }) {
  const interactive = isPressable || onPress || onClick
  const Component = interactive ? NativeButton : Surface
  const interaction = interactive ? { type: 'button', disabled: isDisabled, onClick: onPress || onClick, 'data-shape': 'card' } : { as }
  return <Component {...props} {...interaction} className={`${styles.summaryCard} ${className}`}>
    <div className={styles.summaryLabel}>{label}</div>
    <div className={styles.summaryValue}>{value}</div>
    {children && <div className={styles.summaryDetail}>{children}</div>}
  </Component>
}
