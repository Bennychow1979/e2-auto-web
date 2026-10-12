// A progressive enhancement for the three approved English showroom headlines.
// Keep the source text intact for translation, assistive technology and no-JS use.
const settings = {
  approach: {blur: 12, y: -18},
  finance: {blur: 8, y: -10},
  visit: {blur: 10, y: -14},
};

function enhanceHeadlines() {
  if (!/^en(?:-|$)/i.test(document.documentElement.lang)) return;
  if (!window.matchMedia || !window.IntersectionObserver || !Element.prototype.animate) return;
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (preference.matches) return;

  const headlines = [...document.querySelectorAll('h2[data-headline-reveal]')]
    .filter(heading => settings[heading.dataset.headlineReveal]);
  const running = new Map();
  let observer;

  function clear(heading) {
    heading.dataset.headlineState = 'complete';
    for (const animation of running.get(heading) || []) animation.cancel();
    running.delete(heading);
  }

  function play(heading) {
    if (heading.dataset.headlineState !== 'pending') return;
    observer.unobserve(heading);
    if (preference.matches) { clear(heading); return; }
    const {blur, y} = settings[heading.dataset.headlineReveal];
    const animations = [];
    running.set(heading, animations);
    heading.dataset.headlineState = 'playing';
    try {
      const ease = 'cubic-bezier(.23,1,.32,1)';
      heading.querySelectorAll('.e2HeadlineWord').forEach((word, index) => {
        // The approved visit headline pauses an extra beat before its italic ending.
        const pause = heading.dataset.headlineReveal === 'visit' && index >= 4 ? 200 : 0;
        animations.push(word.animate([
          {filter: `blur(${blur}px)`, opacity: .12, transform: `translateY(${y}px)`, offset: 0, easing: ease},
          {filter: 'blur(4px)', opacity: .65, transform: 'translateY(-2px)', offset: .5, easing: ease},
          {filter: 'blur(0px)', opacity: 1, transform: 'translateY(0)', offset: 1},
        ], {duration: 700, delay: index * 200 + pause, easing: 'linear', fill: 'backwards'}));
      });
      // Cancellation (including a preference change) must also leave readable text.
      Promise.allSettled(animations.map(animation => animation.finished)).then(() => clear(heading));
    } catch { clear(heading); }
  }

  function reduceMotion() {
    if (!preference.matches) return;
    observer?.disconnect();
    headlines.forEach(clear);
    preference.removeEventListener('change', reduceMotion);
  }

  try {
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio >= .55) play(entry.target);
      }
    }, {threshold: .55, rootMargin: '0px 0px -8% 0px'});

    for (const heading of headlines) {
      const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
      const textNodes = [];
      while (walker.nextNode()) textNodes.push(walker.currentNode);
      for (const node of textNodes) {
        const fragment = document.createDocumentFragment();
        for (const token of node.textContent.split(/(\s+)/)) {
          if (!token) continue;
          if (/^\s+$/.test(token)) fragment.append(document.createTextNode(token));
          else {
            const word = document.createElement('span');
            word.className = 'e2HeadlineWord';
            word.textContent = token;
            fragment.append(word);
          }
        }
        node.replaceWith(fragment);
      }
      heading.dataset.headlineState = 'pending';
      observer.observe(heading);
    }
    preference.addEventListener('change', reduceMotion);
  } catch {
    observer?.disconnect();
    headlines.forEach(clear);
  }
}

enhanceHeadlines();
