import {validCode} from './partner-referral-core.mjs';
import {validId} from './referral.js';
export function teamContextURL(href, base) {
  const current = new URL(base), target = new URL(href, base);
  if (target.origin !== current.origin || !/\/(?:index|showroom|booking|sales-team)\.html$/.test(target.pathname)) return target.href;
  for (const [key, valid] of [['ref',validCode],['sales',validId]]) {
    const value = current.searchParams.get(key);
    if (valid(value) && !target.searchParams.has(key)) target.searchParams.set(key,value);
  }
  return target.href;
}
// Carry existing attribution only. Choosing an advisor never changes lead ownership.
if (typeof document !== 'undefined') {
  const teamPage = location.pathname.endsWith('/sales-team.html');
  for (const link of document.querySelectorAll(teamPage ? 'a[href]' : 'a.navTeam[href]')) {
    if (!link.hasAttribute('data-language')) link.href = teamContextURL(link.getAttribute('href'),location.href);
  }
}
