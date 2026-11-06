import '../shared/theme.css';
import './photobooth.css';
import { h, mount, sleep } from '../shared/dom';
import { api, poll } from '../shared/api';
import { installChrome } from '../shared/chrome';
import { onScreenKeyboard } from '../shared/keyboard';
import { CONSENT_TEXT_VERSION, consentNote } from '../shared/consent';
import { openCamera, type CameraSource } from './camera';
import { shutter, tick } from './sound';

// Flow: attract → email → pose/countdown/flash → review (one retake) → submit
// → live progress (optional; "Done" any time) → result, or "Saved!" if offline.

// ---------- Types mirrored from backend/holodeck/photobooth ----------
interface Step {
  key: string;
  label: string;
  state: 'pending' | 'running' | 'retrying' | 'done' | 'failed' | 'skipped';
  attempts: number;
  detail: string;
  url: string | null;
  seconds: number;
}
interface Status {
  session_id: string;
  workflow_id: string;
  stage: 'spooled' | 'unreachable' | 'starting' | 'processing' | 'sending' | 'done';
  steps: Step[];
  strip_url?: string | null;
  animated_url?: string | null;
  email: string;
}
interface Started { session_id: string; workflow_id: string; spooled: boolean; provider: string }

const STALL_MS = 45_000; // no visible progress for this long → "we'll email it"

// ---------- State ----------
const root = document.getElementById('app')!;
let camera: CameraSource | null = null;
let retakesLeft = 1;
let photo = '';
let email = '';
let cleanups: (() => void)[] = [];

installChrome();

function screen(...children: (Node | null)[]): HTMLElement {
  cleanups.forEach((c) => c());
  cleanups = [];
  return mount(root, h('div', { class: 'screen fade-in', style: 'align-items:center' }, ...children));
}

function later(fn: () => void, ms: number): void {
  const t = window.setTimeout(fn, ms);
  cleanups.push(() => clearTimeout(t));
}

function reset(): void {
  retakesLeft = 1;
  photo = '';
  email = '';
  void attract();
}

function viewfinder(content: Node, overlay?: Node | null): HTMLElement {
  // Re-attaching a <video> can pause it; nudge it back to playing.
  if (content instanceof HTMLVideoElement) queueMicrotask(() => void content.play().catch(() => undefined));
  return h('div', { class: 'pb-viewfinder' }, content, h('div', { class: 'pb-brackets' }, h('i')), overlay ?? null);
}

function header(title: string, sub?: string): HTMLElement {
  return h('div', { style: 'text-align:center;display:flex;flex-direction:column;align-items:center;gap:calc(var(--u)*1)' },
    h('p', { class: 'temporal-badge' }, 'Holodeck · Holo-Booth'),
    h('h1', {}, title),
    sub ? h('p', { class: 'dim', style: 'margin:0;font-size:calc(var(--u)*2.2)' }, sub) : null);
}

// ---------- 1. Attract ----------
async function attract(): Promise<void> {
  camera ??= await openCamera();
  screen(
    header('Holo-Booth', 'Step into the frame. Our AI will beam you across the galaxy.'),
    h('div', { class: 'pb-split' },
      viewfinder(camera.el, camera.live ? h('div', { class: 'pb-rec' }, 'Live') : null),
      h('div', { class: 'pb-side' },
        h('div', { class: 'panel' },
          h('span', { class: 'panel-tab' }, 'How it works'),
          h('p', { style: 'margin:0' }, 'One photo. Four AI-generated frames: become an alien, fly a starship, explore a strange new world. We email you the strip.')),
        !camera.live ? h('p', { class: 'dim' }, 'No camera found, so we’ll use our test visitor.') : null,
        h('button', { class: 'btn mint big', onclick: emailScreen }, 'Start'),
      ),
    ),
  );
}

// ---------- 2. Email (required) ----------
function emailScreen(): void {
  const kb = onScreenKeyboard({
    mode: 'email',
    initial: email,
    placeholder: 'you@company.com',
    submitLabel: 'Next',
    onSubmit: (v) => { email = v; pose(); },
  });
  screen(
    header('Where should we send your strip?', 'We’ll email your AI photo strip when it’s ready.'),
    h('div', { class: 'pb-side', style: 'max-width:calc(var(--u)*90)' },
      kb.el,
      consentNote(),
      h('button', { class: 'btn ghost', onclick: reset }, 'Cancel'),
    ),
  );
  cleanups.push(kb.destroy);
}

// ---------- 3. Pose + countdown + flash ----------
function pose(): void {
  screen(
    header('Strike a pose', 'Get in the frame. We’ll count you down.'),
    h('div', { class: 'pb-split' },
      viewfinder(camera!.el, camera!.live ? h('div', { class: 'pb-rec' }, 'Live') : null),
      h('div', { class: 'pb-side' },
        h('p', { class: 'dim', style: 'margin:0' }, `Sending to ${email}`),
        h('button', { class: 'btn mint big', onclick: () => void countdown() }, 'I’m ready'),
        h('button', { class: 'btn ghost', onclick: emailScreen }, 'Change email'),
      ),
    ),
  );
}

async function countdown(): Promise<void> {
  const count = h('div', { class: 'pb-count' });
  screen(header('Get ready!', 'Look at the camera'), h('div', { class: 'pb-split', style: 'justify-items:center' }, viewfinder(camera!.el, count)));
  for (const n of [3, 2, 1]) {
    count.replaceChildren(h('span', {}, String(n)));
    tick(n === 1 ? 1320 : 880);
    await sleep(1000);
  }
  count.replaceChildren();
  shutter();
  photo = camera!.capture();
  const flash = h('div', { class: 'pb-flash' });
  document.body.append(flash);
  setTimeout(() => flash.remove(), 650);
  review();
}

// ---------- 4. Review (+ quick best-effort photo check) ----------
interface QuickCheck { checked: boolean; usable?: boolean; reason?: string; face_count?: number }

function hintFor(reason = ''): string {
  const r = reason.toLowerCase();
  if (r.includes('dark')) return 'It\u2019s a little dark over there. Step into the light!';
  if (r.includes('blur')) return 'A bit blurry! Hold still for the countdown and try again.';
  return 'We can\u2019t see your face. Step into the frame and into the light!';
}

async function quickCheck(image: string): Promise<QuickCheck | null> {
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 4000));
  try {
    return await Promise.race([api<QuickCheck>('/photobooth/analyze', { image }), timeout]);
  } catch {
    return null; // network down or server busy: skip silently, the workflow copes
  }
}

function review(): void {
  const shot = photo;
  const hint = h('div', {});
  const retakeSlot = h('div', {});
  const renderRetake = (free: boolean) => {
    retakeSlot.replaceChildren(
      free
        ? h('button', { class: 'btn amber', onclick: () => void countdown() }, 'Try again (free)')
        : retakesLeft > 0
          ? h('button', { class: 'btn ghost', onclick: () => { retakesLeft--; void countdown(); } }, 'Retake (1 left)')
          : h('span'));
  };
  renderRetake(false);
  screen(
    header('Looking good!', retakesLeft > 0 ? 'Happy with it? You get one retake.' : 'That\u2019s the one. Let\u2019s go!'),
    h('div', { class: 'pb-split' },
      viewfinder(h('img', { src: photo, alt: 'Your photo' })),
      h('div', { class: 'pb-side' },
        hint,
        h('button', { class: 'btn mint big', onclick: () => void submit() }, 'Beam me up \u2728'),
        retakeSlot,
      ),
    ),
  );
  void quickCheck(shot).then((r) => {
    if (photo !== shot || !r?.checked || r.usable !== false) return;
    // An unusable photo doesn't use up the visitor's one retake.
    const title = root.querySelector('h1');
    if (title) title.textContent = 'Almost!';
    root.querySelector('h1 + p')?.remove();
    hint.replaceChildren(h('div', { class: 'panel pb-hint fade-in' },
      h('span', { class: 'panel-tab' }, 'Sensor check'),
      h('p', { style: 'margin:0;font-size:calc(var(--u)*2.4)' }, hintFor(r.reason))));
    renderRetake(true);
  });
}

// ---------- 5. Submit (local-first on the server) ----------
async function submit(): Promise<void> {
  screen(header('Beaming…', 'Saving your photo'));
  try {
    const s = await api<Started>('/photobooth/sessions', { image: photo, email, consent_text_version: CONSENT_TEXT_VERSION });
    if (s.spooled) saved();
    else processing(s);
  } catch (e) {
    failure(e);
  }
}

// ---------- 6a. Saved (offline / stalled): the email comes later; Done starts over ----------
function saved(): void {
  screen(
    header('Saved!', ''),
    h('div', { class: 'pb-side', style: 'align-items:center;text-align:center' },
      h('div', { class: 'panel' },
        h('span', { class: 'panel-tab' }, 'Transmission queued'),
        h('p', { style: 'margin:0;font-size:calc(var(--u)*2.6)' },
          'Your holo-strip will arrive by email once our subspace relay reconnects.'),
        h('p', { class: 'dim' }, `Destination: ${email}`)),
      h('p', { class: 'dim' }, 'Your photo is stored safely on this ship. Temporal will finish the job, even if the network doesn’t cooperate right now.'),
      h('button', { class: 'btn mint big', onclick: reset }, 'Done'),
    ),
  );
}

// ---------- 6b. Live progress ----------
function fillThumbs(thumbs: HTMLElement, st: Status): void {
  st.steps.filter((s) => s.key.startsWith('render-')).forEach((r, i) => {
    const slot = thumbs.children[i] as HTMLElement | undefined;
    if (slot && r.url && !slot.querySelector('img')) {
      slot.replaceChildren(h('img', { src: r.url, alt: r.label }));
      slot.style.animation = 'none';
    }
  });
}

function stepRow(s: Step): HTMLElement {
  const meta =
    s.state === 'retrying' ? `retry #${s.attempts}` :
    s.state === 'done' ? (s.detail || (s.seconds >= 1 ? `${s.seconds.toFixed(0)}s` : 'done')) :
    s.state === 'running' ? 'working…' : '';
  return h('div', { class: `wf-step ${s.state}` },
    h('span', { class: 'dot' }),
    h('span', {}, s.label),
    h('span', { class: 'meta' }, meta),
    s.state === 'retrying' && s.detail ? h('span', { class: 'why' }, `⚠ ${s.detail.replace(/^[\w[\]-]+: /, '').slice(0, 120)}`) : null);
}

function processing(s: Started): void {
  const steps = h('div', { class: 'wf-steps pb-steps' });
  const thumbs = h('div', { class: 'pb-thumbs' }, ...[0, 1, 2, 3].map(() => h('div', { class: 'pb-thumb' })));
  screen(
    header('Rendering your adventure', 'Watch it happen, or walk away: we’ll email it either way.'),
    h('div', { class: 'pb-split even' },
      h('div', { class: 'pb-side' }, thumbs),
      h('div', { class: 'pb-side' },
        h('button', { class: 'btn mint big', onclick: reset }, 'Done — we’ll email it'),
        h('div', { class: 'panel' }, h('span', { class: 'panel-tab' }, 'Workflow'), steps),
        h('p', { class: 'pb-wfid' }, 'Powered by Temporal · workflow ', h('b', {}, s.workflow_id)))),
  );
  let fingerprint = '';
  let lastChange = Date.now();
  const stop = poll(() => api<Status>(`/photobooth/sessions/${s.session_id}`), (st) => {
    if (st.stage === 'spooled' || st.stage === 'unreachable') { saved(); return true; }
    const fp = st.steps.map((x) => `${x.state}${x.attempts}`).join();
    if (fp !== fingerprint) { fingerprint = fp; lastChange = Date.now(); }
    steps.replaceChildren(...st.steps.map(stepRow));
    fillThumbs(thumbs, st);
    if (st.stage === 'done') { later(() => result(st), 900); return true; }
    if (Date.now() - lastChange > STALL_MS) { saved(); return true; }
  }, 800);
  cleanups.push(stop);
}

// ---------- 7. Result ----------
function result(st: Status): void {
  let animated = !!st.animated_url;
  const img = h('img', { class: 'pb-strip', src: (animated ? st.animated_url : st.strip_url) ?? '', alt: 'Your photo strip' });
  const toggle = st.animated_url
    ? h('button', { class: 'btn ghost', onclick: () => {
        animated = !animated;
        img.src = (animated ? st.animated_url : st.strip_url)!;
        toggle!.textContent = animated ? 'Show still' : 'Show animated';
      } }, 'Show still')
    : null;
  screen(
    header('Greetings, space traveler!', `Your strip is on its way to ${st.email}`),
    h('div', { class: 'pb-split' },
      img,
      h('div', { class: 'pb-side' },
        h('div', { class: 'panel' },
          h('span', { class: 'panel-tab' }, 'What just happened'),
          h('p', { style: 'margin:0' },
            'A Temporal workflow ran four AI image generations in parallel, retried the ones that failed, composed the strip, and emailed it. If the network had dropped, it would have picked up where it left off.')),
        h('p', { class: 'pb-wfid' }, 'workflow ', h('b', {}, st.workflow_id)),
        h('div', { class: 'row', style: 'flex-wrap:nowrap' },
          toggle,
          h('button', { class: 'btn mint big', style: 'flex:1', onclick: reset }, 'Done')),
      ),
    ),
  );
}

function failure(e: unknown): void {
  console.error(e);
  screen(
    header('Transporter malfunction', 'We couldn’t save your photo. Please ask a crew member for help.'),
    h('p', { class: 'dim' }, String(e)),
    h('button', { class: 'btn amber big', onclick: reset }, 'Start over'),
  );
}

void attract();
