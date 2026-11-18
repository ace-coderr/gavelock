// Optional dial sounds, synthesised on the spot (no audio files). Off until the visitor switches it on, and
// the audio context is only created from that click, so nothing ever plays by itself.
let ctx: AudioContext | null = null;
let on = false;

export function soundOn(): boolean {
  return on;
}

export function setSound(value: boolean): boolean {
  on = value;
  if (value && !ctx) {
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      ctx = Ctor ? new Ctor() : null;
    } catch {
      ctx = null;
    }
    if (!ctx) on = false;
  }
  if (on && ctx?.state === 'suspended') void ctx.resume();
  return on;
}

function blip(type: OscillatorType, from: number, to: number, seconds: number, gain: number): void {
  if (!on || !ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + seconds);
  amp.gain.setValueAtTime(gain, t);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  osc.connect(amp).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + seconds + 0.02);
}

/** A soft click at every stage boundary. */
export function playTick(): void {
  blip('triangle', 1500, 700, 0.035, 0.05);
}

/** A low thud for the gavel. */
export function playThud(): void {
  blip('sine', 140, 48, 0.24, 0.22);
  blip('triangle', 420, 90, 0.07, 0.08);
}
