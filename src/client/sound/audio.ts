/**
 * Tiny WebAudio cue set. No files, no libraries, no sound until the player has
 * made a gesture. Every cue is a short oscillator or a burst of filtered noise
 * so nothing runs past 400ms and nothing blocks input.
 */

export type Cue =
  | 'click'
  | 'roll'
  | 'place'
  | 'reject'
  | 'award'
  | 'win'
  | 'card'
  | 'buy'
  | 'shuffle'
  | 'turn';

let context: AudioContext | null = null;
let enabled = true;
const recent = new Map<Cue, number>();

function ctx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!context) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
  }
  if (context.state === 'suspended') void context.resume();
  return context;
}

export function setSoundEnabled(on: boolean): void {
  enabled = on;
}

export function isSoundEnabled(): boolean {
  return enabled;
}

function noiseBurst(at: number, duration: number, freq: number, gainValue: number): void {
  const audio = ctx();
  if (!audio) return;
  const frames = Math.max(1, Math.floor(audio.sampleRate * duration));
  const buffer = audio.createBuffer(1, frames, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }
  const source = audio.createBufferSource();
  source.buffer = buffer;
  const filter = audio.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = 0.9;
  const gain = audio.createGain();
  gain.gain.value = gainValue;
  source.connect(filter).connect(gain).connect(audio.destination);
  source.start(at);
}

function tone(at: number, freq: number, duration: number, type: OscillatorType, gainValue: number): void {
  const audio = ctx();
  if (!audio) return;
  const osc = audio.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(gainValue, at + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  osc.connect(gain).connect(audio.destination);
  osc.start(at);
  osc.stop(at + duration + 0.02);
}

/** Play a cue, unless muted, hidden, or repeating faster than 60ms. */
export function playCue(cue: Cue): void {
  if (!enabled) return;
  if (typeof document !== 'undefined' && document.hidden) return;
  const now = Date.now();
  const last = recent.get(cue) ?? 0;
  if (now - last < 60) return;
  recent.set(cue, now);
  const audio = ctx();
  if (!audio) return;
  const t = audio.currentTime;

  switch (cue) {
    case 'click':
      noiseBurst(t, 0.008, 1800, 0.05);
      break;
    case 'card':
      noiseBurst(t, 0.09, 2600, 0.05);
      tone(t + 0.01, 520, 0.08, 'triangle', 0.03);
      break;
    case 'roll':
      noiseBurst(t, 0.07, 900, 0.08);
      tone(t + 0.05, 740, 0.06, 'square', 0.03);
      tone(t + 0.16, 980, 0.06, 'square', 0.03);
      noiseBurst(t + 0.24, 0.18, 500, 0.05);
      break;
    case 'place':
      tone(t, 70, 0.18, 'sine', 0.12);
      noiseBurst(t, 0.05, 400, 0.04);
      break;
    case 'reject':
      tone(t, 310, 0.09, 'sine', 0.05);
      tone(t + 0.1, 220, 0.12, 'sine', 0.05);
      break;
    case 'buy':
      tone(t, 640, 0.07, 'triangle', 0.04);
      tone(t + 0.08, 860, 0.1, 'triangle', 0.035);
      break;
    case 'shuffle':
      // A short riffle: four paper ticks that rise in pitch, then settle.
      noiseBurst(t, 0.05, 1400, 0.04);
      noiseBurst(t + 0.05, 0.05, 1900, 0.035);
      noiseBurst(t + 0.1, 0.05, 2400, 0.03);
      tone(t + 0.16, 520, 0.09, 'triangle', 0.025);
      break;
    case 'award':
      tone(t, 660, 0.16, 'sine', 0.05);
      tone(t + 0.02, 990, 0.22, 'sine', 0.04);
      break;
    case 'win':
      tone(t, 523, 0.3, 'sine', 0.06);
      tone(t, 784, 0.34, 'sine', 0.05);
      tone(t + 0.12, 1046, 0.4, 'sine', 0.045);
      break;
    case 'turn':
      tone(t, 392, 0.12, 'triangle', 0.035);
      break;
    default:
      break;
  }
}
