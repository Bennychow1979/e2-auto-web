// Restored 11 Oct demo: staggered 9-second centre-out / enlarge / fade cycles.
export function photoFrame(index, count, elapsed, width, height) {
  const phase = ((elapsed / 9000 + (index + .6) / count) % 1 + 1) % 1;
  const angle = -Math.PI / 2 + index * Math.PI * 2 / count;
  const distance = .06 + phase * .98;
  const mobile = width < 620;
  return {
    x: Math.cos(angle) * width * (mobile ? .31 : .36) * distance,
    y: Math.sin(angle) * height * .34 * distance,
    scale: .45 + phase * .70,
    opacity: Math.max(0, Math.min(1, phase / .16, (1 - phase) / .10))
  };
}
export function motionAllowed({hidden, selected, paused, reduced, keyboard, count}) {
  return count > 0 && count <= 12 && !hidden && !selected && !paused && !reduced && !keyboard;
}
