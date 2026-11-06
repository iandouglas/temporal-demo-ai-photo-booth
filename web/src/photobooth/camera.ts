/**
 * Camera source for the booth: the webcam when available, otherwise an
 * animated canvas "test visitor" so the flow is testable without a camera.
 */
export interface CameraSource {
  el: HTMLVideoElement | HTMLCanvasElement;
  live: boolean;
  /** Capture the current frame as a mirrored 3:4 portrait JPEG data URL. */
  capture(): string;
}

const OUT_W = 768;
const OUT_H = 1024;

export async function openCamera(): Promise<CameraSource> {
  const test = new URLSearchParams(location.search).get('testcam');
  if (test !== null) return testVisitor(test === 'dark');
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera API');
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    const video = document.createElement('video');
    video.className = 'mirror';
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    return { el: video, live: true, capture: () => grab(video, video.videoWidth, video.videoHeight, true) };
  } catch (e) {
    console.warn('Camera unavailable, using test visitor', e);
    return testVisitor(false);
  }
}

function grab(src: CanvasImageSource, sw: number, sh: number, mirror: boolean): string {
  const c = document.createElement('canvas');
  c.width = OUT_W;
  c.height = OUT_H;
  const ctx = c.getContext('2d')!;
  // Center-crop the source to 3:4 portrait.
  const target = OUT_W / OUT_H;
  let cw = sw, ch = sh;
  if (sw / sh > target) cw = sh * target; else ch = sw / target;
  const sx = (sw - cw) / 2, sy = (sh - ch) / 2;
  if (mirror) { ctx.translate(OUT_W, 0); ctx.scale(-1, 1); }
  ctx.drawImage(src, sx, sy, cw, ch, 0, 0, OUT_W, OUT_H);
  return c.toDataURL('image/jpeg', 0.9);
}

function testVisitor(dark = false): CameraSource {
  const c = document.createElement('canvas');
  c.width = OUT_W;
  c.height = OUT_H;
  const ctx = c.getContext('2d')!;
  let t = 0;
  const draw = () => {
    t += 1 / 60;
    const w = OUT_W, hh = OUT_H;
    const bob = Math.sin(t * 1.5) * 8;
    const g = ctx.createLinearGradient(0, 0, 0, hh);
    g.addColorStop(0, '#6b7c93');
    g.addColorStop(1, '#3d4a5c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, hh);
    ctx.fillStyle = '#2d4fa8';
    ctx.beginPath(); ctx.ellipse(w / 2, hh * 1.02, w * 0.46, hh * 0.36, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e0b090';
    ctx.fillRect(w * 0.43, hh * 0.5 + bob, w * 0.14, hh * 0.16);
    ctx.beginPath(); ctx.ellipse(w / 2, hh * 0.36 + bob, w * 0.21, hh * 0.19, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3b2618';
    ctx.beginPath(); ctx.ellipse(w / 2, hh * 0.24 + bob, w * 0.22, hh * 0.09, 0, Math.PI, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1d1d28';
    const blink = Math.sin(t * 2.3) > 0.97 ? 2 : 11;
    for (const x of [0.42, 0.58]) { ctx.beginPath(); ctx.ellipse(w * x, hh * 0.35 + bob, 14, blink, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = '#9a3a48'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.arc(w / 2, hh * 0.4 + bob, w * 0.07, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = '600 28px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('TEST VISITOR (no camera found)', w / 2, hh * 0.08);
    if (dark) { ctx.fillStyle = 'rgba(0,0,0,0.94)'; ctx.fillRect(0, 0, w, hh); }
    requestAnimationFrame(draw);
  };
  draw();
  return { el: c, live: false, capture: () => grab(c, OUT_W, OUT_H, false) };
}
