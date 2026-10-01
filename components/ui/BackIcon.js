/** Shared decorative back-navigation artwork. The parent supplies the accessible label. */
export default function BackIcon({ className = '', size, white = false, style, ...props }) {
  return <img {...props} src="/icons/back.png" alt="" aria-hidden="true" draggable={false}
    className={`talio-back-icon ${className}`} width={size || 20} height={size || 20}
    style={{ ...(size ? { width: size, height: size } : {}), ...style, ...(white ? { filter: 'invert(1)' } : {}) }} />
}
