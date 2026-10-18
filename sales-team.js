import {t} from './i18n.mjs';
import {publicTeamSource, contactURL} from './sales-team-data.mjs';
import {photoFrame, motionAllowed} from './sales-team-motion.mjs';

const $ = id => document.getElementById(id);
const source = publicTeamSource(window.E2_CONFIG);
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const stage = $('teamStage'), photos = $('teamPhotos'), dialog = $('advisorDialog');
let profiles = [], selected = null, paused = false, keyboard = false, elapsed = 0, last = 0, frame = 0, generation = 0;
let selectionRun = 0, opener = null, refreshing = null;
const portraits = new Map();
const staticView = () => reduced.matches || keyboard || profiles.length > 12;
const allowed = () => motionAllowed({hidden: document.hidden, selected, paused, reduced: reduced.matches, keyboard, count: profiles.length});
function paint() {
  if (staticView()) return;
  const {width, height} = stage.getBoundingClientRect();
  [...photos.children].forEach((button, i) => {
    const p = photoFrame(i, profiles.length, elapsed, width, height);
    button.style.transform = `translate(-50%,-50%) translate(${p.x}px,${p.y}px) scale(${p.scale})`;
    button.style.opacity = p.opacity;
    button.style.zIndex = Math.round(p.scale * 100);
  });
}
function tick(now) {
  frame = 0;
  if (!allowed()) { last = 0; return; }
  if (last) elapsed += Math.min(64, now - last);
  last = now; paint(); frame = requestAnimationFrame(tick);
}
function syncMotion() {
  stage.classList.toggle('teamStatic', staticView());
  $('teamMotion').hidden = reduced.matches || profiles.length > 12 || !profiles.length;
  $('teamMotion').textContent = t(paused || keyboard ? 'Resume photos' : 'Pause photos');
  $('teamMotion').setAttribute('aria-pressed', String(paused || keyboard));
  $('teamMotionStatus').textContent = profiles.length ? t(staticView() ? 'Static view · select any advisor' : allowed() ? 'Playing · photos flow outward' : 'Paused') : '';
  if (frame) cancelAnimationFrame(frame);
  frame = 0; last = 0; paint();
  if (allowed()) frame = requestAnimationFrame(tick);
}
// One promise and URL per public photo revision. The same image is reused in flow and profile.
async function portrait(profile) {
  if (!profile.photo) return null;
  if (!portraits.has(profile.photo)) portraits.set(profile.photo, source.portrait(profile).catch(() => null));
  return portraits.get(profile.photo);
}
function imageFor(profile, priority = false) {
  const wrap = document.createElement('span'); wrap.className = 'teamPortrait';
  const fallback = document.createElement('span'); fallback.className = 'teamInitials';
  fallback.textContent = profile.name.split(/\s+/).slice(0, 2).map(word => [...word][0]).join('');
  fallback.setAttribute('aria-hidden', 'true'); wrap.append(fallback);
  const img = document.createElement('img'); img.alt = ''; img.loading = priority ? 'eager' : 'lazy'; img.decoding = 'async'; img.width = 400; img.height = 400;
  img.hidden = true; img.style.opacity = '0'; img.addEventListener('load', () => {img.hidden = false; img.style.opacity = '1'; fallback.hidden = true;});
  img.addEventListener('error', () => {img.hidden = true; fallback.hidden = false;});
  wrap.append(img);
  portrait(profile).then(url => {if (url && wrap.isConnected) {img.hidden = false; img.src = url;}});
  return wrap;
}
function render() {
  photos.replaceChildren();
  for (const profile of profiles) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'teamPhoto'; button.dataset.id = profile.id;
    button.setAttribute('aria-label', profile.name); button.setAttribute('aria-haspopup', 'dialog');
    const label = document.createElement('span'); label.className = 'teamPhotoName'; label.textContent = profile.name;
    button.append(imageFor(profile), label); button.addEventListener('click', () => selectProfile(profile.id, button)); photos.append(button);
  }
  stage.hidden = !profiles.length; $('teamHint').hidden = !profiles.length; syncMotion();
}
function clearContact() { $('advisorContact').hidden = true; $('advisorContact').removeAttribute('href'); }
function showProfile(profile) {
  selected = profile;
  $('advisorName').textContent = profile.name; $('advisorPosition').textContent = profile.position;
  $('advisorBio').textContent = profile.bio || t('Please ask your advisor for more details.');
  $('advisorLanguages').textContent = profile.languages || t('Please confirm languages with your advisor.');
  $('advisorPortrait').replaceChildren(imageFor(profile, true));
  const url = contactURL(profile, t('Hi {name}, I would like to ask about a car at E2 Auto.', {name: profile.name}));
  clearContact(); if (url) {$('advisorContact').href = url; $('advisorContact').hidden = false;}
  $('advisorState').textContent = url ? '' : t('WhatsApp unavailable');
}
async function selectProfile(id, button) {
  const run = ++selectionRun; selected = profiles.find(p => p.id === id); if (!selected) return;
  opener = button; showProfile(selected); clearContact(); $('advisorState').textContent = t('Checking current public details…');
  dialog.showModal(); $('advisorClose').focus(); syncMotion();
  try {
    const latest = await source.profiles(); if (run !== selectionRun || !dialog.open) return;
    const profile = latest.find(p => p.id === id);
    if (!profile) { unavailable(); await refresh(); return; }
    showProfile(profile);
  } catch { if (run === selectionRun) unavailable('We could not load the team. Please try again.'); }
}
function unavailable(message = 'This profile is no longer available.') {
  clearContact(); $('advisorPortrait').replaceChildren(); $('advisorBio').textContent = '';
  $('advisorLanguages').textContent = ''; $('advisorPosition').textContent = ''; $('advisorName').textContent = t('Sales team'); $('advisorState').textContent = t(message);
}
function closeProfile() { if (dialog.open) dialog.close(); }
dialog.addEventListener('close', () => {
  ++selectionRun; selected = null; clearContact();
  if (opener?.isConnected) opener.focus({preventScroll: true}); else $('teamRetry').focus();
  syncMotion();
});
$('advisorClose').addEventListener('click', closeProfile);
dialog.addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const controls = [ $('advisorClose'), ...(!$('advisorContact').hidden ? [$('advisorContact')] : []) ];
  const index = controls.indexOf(document.activeElement);
  if (event.shiftKey && index <= 0) {event.preventDefault(); controls.at(-1).focus();}
  else if (!event.shiftKey && index === controls.length - 1) {event.preventDefault(); controls[0].focus();}
});
dialog.addEventListener('click', event => {if (event.target === dialog) {const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeProfile();}});
$('teamMotion').addEventListener('click', () => {if (keyboard) {keyboard = false; paused = false;} else paused = !paused; syncMotion();});
document.addEventListener('keydown', event => {if (event.key === 'Tab' && !dialog.open && !keyboard) {keyboard = true; syncMotion();}});
photos.addEventListener('keydown', event => {
  const buttons = [...photos.children], index = buttons.indexOf(document.activeElement);
  if (index < 0 || !['ArrowRight','ArrowLeft','ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
  event.preventDefault(); keyboard = true; syncMotion();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (['ArrowRight','ArrowDown'].includes(event.key) ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next].focus();
});
async function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const run = ++generation; $('teamRetry').disabled = true;
    try {
      const latest = await source.profiles(); if (run !== generation) return;
      const changed = JSON.stringify(latest) !== JSON.stringify(profiles); profiles = latest;
      if (changed) render();
      $('teamState').textContent = profiles.length ? '' : t('Our public team profiles are not available yet.');
      $('teamRetry').hidden = !!profiles.length;
      if (selected && dialog.open) {const current = profiles.find(p => p.id === selected.id); if (current) showProfile(current); else unavailable();}
    } catch {
      profiles = []; render(); portraits.clear();
      $('teamState').textContent = t('We could not load the team. Please try again.'); $('teamRetry').hidden = false;
      if (dialog.open) unavailable('We could not load the team. Please try again.');
    } finally { $('teamRetry').disabled = false; refreshing = null; syncMotion(); }
  })();
  return refreshing;
}
$('teamRetry').addEventListener('click', () => {portraits.clear(); refresh();});
reduced.addEventListener('change', syncMotion);
new ResizeObserver(() => paint()).observe(stage);
document.addEventListener('visibilitychange', () => {syncMotion(); if (!document.hidden) refresh(); else clearContact();});
window.addEventListener('pageshow', () => refresh());
window.addEventListener('online', () => refresh());
setInterval(() => {if (!document.hidden) refresh();}, 60000);
await refresh();
