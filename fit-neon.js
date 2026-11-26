// Keep the HTML heading readable until its optional, on-screen effect is ready.
const heading = document.querySelector('[data-fit-neon]');
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
if (heading && !reduce.matches && 'IntersectionObserver' in window) {
  let cleanup, disposed = false;
  const observer = new IntersectionObserver(async entries => {
    if (!entries.some(e => e.isIntersecting && e.intersectionRatio >= .5)) return;
    observer.disconnect();
    try {
      await document.fonts.ready;
      if (disposed) return;
      const text = document.createElement('span');
      text.className = 'e2NeonText';
      text.textContent = heading.textContent;
      heading.replaceChildren(text);
      const surface = document.createElement('span');
      surface.className = 'e2NeonSurface'; surface.setAttribute('aria-hidden', 'true');
      heading.append(surface);
      const {mountNeonHeading} = await import('./fit-neon-renderer.mjs?v=1');
      if (disposed) { surface.remove(); return; }
      cleanup = mountNeonHeading(surface, text);
      if (disposed) cleanup?.();
    } catch { heading.querySelector('.e2NeonSurface')?.remove(); }
  }, {threshold: .5});
  observer.observe(heading);
  const stop = () => {
    disposed = true; observer.disconnect(); cleanup?.();
    heading.querySelector('.e2NeonSurface')?.remove();
  };
  reduce.addEventListener('change', () => { if (reduce.matches) stop(); });
  addEventListener('pagehide', stop, {once: true});
}
