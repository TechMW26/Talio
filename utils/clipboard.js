export async function copyTextToClipboard(text) {
  if (!text) {
    throw new Error('Nothing to copy')
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }
  } catch {
    // Fall through to the selection-based fallback for restricted browsers.
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()

  try {
    if (!document.execCommand('copy')) {
      throw new Error('Clipboard access was denied')
    }
  } finally {
    textarea.remove()
  }
}
