// Fernly app.css: --ease / dlg-in. No animation library added.
export const fernlyDialogMotion = {
  variants: {
    enter: { opacity: 1, y: 0, scale: 1, transition: { duration: .35, ease: [.22, 1, .36, 1] } },
    exit: { opacity: 0, y: 14, scale: .98, transition: { duration: .2, ease: [.22, 1, .36, 1] } },
  },
}
