// Lightweight folder-origin motion: one animation on the actual card, no clones.
export function folderGenieFrames(source, target) {
  const x = source.left + source.width / 2 - target.left - target.width / 2
  const y = source.top + source.height * .4 - target.top - target.height / 2
  const sx = Math.min(.65, Math.max(.08, source.width * .65 / Math.max(target.width, 1)))
  return [
    { offset: 0, opacity: 0, transform: `translate(${x}px, ${y}px) scale(${sx}, .04)`, clipPath: 'polygon(35% 0, 65% 0, 80% 50%, 100% 100%, 0 100%, 20% 50%)' },
    { offset: .36, opacity: 1, transform: `translate(${x * .4}px, ${y * .5}px) scale(.8, .65)`, clipPath: 'polygon(22% 0, 78% 0, 88% 50%, 100% 100%, 0 100%, 12% 50%)' },
    { offset: .75, opacity: 1, transform: 'translate(0, 0) scale(1, 1)', clipPath: 'polygon(3% 0, 97% 0, 100% 50%, 100% 100%, 0 100%, 0 50%)' },
    { offset: 1, opacity: 1, transform: 'translate(0, 0) scale(1, 1)', clipPath: 'polygon(0 0, 100% 0, 100% 50%, 100% 100%, 0 100%, 0 50%)' },
  ]
}
