import type { GameEvent } from '../../../../shared/src/engine/sim';
import { getSettings } from '../../settings';

/**
 * Original synthesized audio (WebAudio). No external audio files are used.
 * The context is created lazily on the first user gesture (browser autoplay rules).
 */
class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private musicTimer: number | null = null;
  private step = 0;

  private ensure(): AudioContext | null {
    if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.musicGain = this.ctx.createGain();
        this.musicGain.connect(this.master);
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.master!.gain.value = getSettings().volume;
    return this.ctx;
  }

  unlock(): void {
    this.ensure();
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slide = 0, dest?: AudioNode): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), ctx.currentTime + dur);
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g).connect(dest ?? this.master);
    o.start();
    o.stop(ctx.currentTime + dur + 0.02);
  }

  private noise(dur: number, vol: number, hp = 800): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master);
    src.start();
  }

  sfx(name: 'hit' | 'heavy' | 'block' | 'whoosh' | 'select' | 'confirm' | 'ko' | 'super' | 'fireball' | 'round' | 'back'): void {
    if (!getSettings().sfx) return;
    switch (name) {
      case 'hit':
        this.noise(0.08, 0.5, 1200);
        this.tone(180, 0.08, 'square', 0.15, -100);
        break;
      case 'heavy':
        this.noise(0.16, 0.7, 500);
        this.tone(110, 0.18, 'square', 0.22, -70);
        break;
      case 'block':
        this.tone(880, 0.06, 'triangle', 0.15, -300);
        break;
      case 'whoosh':
        this.noise(0.06, 0.12, 3000);
        break;
      case 'select':
        this.tone(660, 0.05, 'square', 0.08);
        break;
      case 'confirm':
        this.tone(523, 0.07, 'square', 0.1);
        setTimeout(() => this.tone(784, 0.1, 'square', 0.1), 70);
        break;
      case 'back':
        this.tone(392, 0.08, 'square', 0.08, -120);
        break;
      case 'ko':
        this.tone(220, 0.6, 'sawtooth', 0.2, -180);
        this.noise(0.4, 0.4, 300);
        break;
      case 'super':
        this.tone(220, 0.4, 'sawtooth', 0.15, 660);
        break;
      case 'fireball':
        this.tone(300, 0.2, 'sawtooth', 0.1, -200);
        this.noise(0.15, 0.15, 900);
        break;
      case 'round':
        this.tone(440, 0.12, 'square', 0.12);
        setTimeout(() => this.tone(660, 0.18, 'square', 0.12), 120);
        break;
    }
  }

  playEvents(events: GameEvent[]): void {
    for (const e of events) {
      if (e.type === 'hit') this.sfx(e.heavy ? 'heavy' : 'hit');
      else if (e.type === 'block') this.sfx('block');
      else if (e.type === 'ko') this.sfx('ko');
      else if (e.type === 'super') this.sfx('super');
      else if (e.type === 'projectile') this.sfx('fireball');
      else if (e.type === 'roundStart' || e.type === 'fight') this.sfx('round');
      else if (e.type === 'dash' || e.type === 'jump') this.sfx('whoosh');
    }
  }

  /** Simple original chiptune loop (bass + arpeggio). */
  startMusic(): void {
    if (!getSettings().music || this.musicTimer !== null) return;
    const ctx = this.ensure();
    if (!ctx || !this.musicGain) return;
    this.musicGain.gain.value = 0.35;
    const bass = [55, 55, 65.4, 49, 55, 55, 73.4, 65.4];
    const arp = [220, 261.6, 329.6, 392, 329.6, 261.6];
    this.musicTimer = window.setInterval(() => {
      if (!getSettings().music) {
        this.stopMusic();
        return;
      }
      const s = this.step++;
      if (s % 2 === 0) this.tone(bass[(s / 2) % bass.length] * 2, 0.22, 'triangle', 0.18, 0, this.musicGain!);
      this.tone(arp[s % arp.length] * (Math.floor(s / 24) % 2 ? 1.122 : 1), 0.09, 'square', 0.035, 0, this.musicGain!);
    }, 150);
  }

  stopMusic(): void {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }
}

export const audio = new AudioEngine();
