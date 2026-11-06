/** Tiny WebAudio blips so we don't need audio assets. */
let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

export function tick(freq = 880): void {
  const a = ac();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.18, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.15);
  o.connect(g).connect(a.destination);
  o.start();
  o.stop(a.currentTime + 0.16);
}

export function shutter(): void {
  const a = ac();
  if (!a) return;
  const len = Math.floor(a.sampleRate * 0.12);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = a.createBufferSource();
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 2400;
  const g = a.createGain();
  g.gain.value = 0.6;
  src.buffer = buf;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}
