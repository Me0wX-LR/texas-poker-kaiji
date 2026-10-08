import { musicById, resolveMusicId, savedMusicId } from "@/lib/table-music";

const SOUND_KEY = "texas-poker-kaiji-sound";

type OscKind = OscillatorType;

/**
 * Original heads-up score and table noises, synthesized in the browser.
 * Nothing here is a recording or a copied track.
 */
export class TableAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private fx: GainNode | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextAt = 0;
  private step = 0;
  private trackId: string;
  private noise: AudioBuffer | null = null;
  muted = false;
  private wanted = false;
  private audible = true;

  constructor() {
    this.trackId = savedMusicId();
    if (typeof localStorage !== "undefined") this.muted = localStorage.getItem(SOUND_KEY) === "off";
  }

  setTrack(id: string): void {
    const next = resolveMusicId(id);
    if (next === this.trackId && this.timer !== null) return;
    this.trackId = next;
    this.step = 0;
    this.nextAt = 0;
    if (this.timer !== null) {
      this.stopLoop();
      if (this.wanted && this.audible && !this.muted) this.startLoop();
    }
  }

  unlock(): void {
    if (typeof window === "undefined") return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!this.ctx) {
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
      this.music = this.ctx.createGain();
      this.music.gain.value = 0.18;
      this.music.connect(this.master);
      this.fx = this.ctx.createGain();
      this.fx.gain.value = 0.8;
      this.fx.connect(this.master);
      this.noise = noiseBuffer(this.ctx, 0.4);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (typeof localStorage !== "undefined") localStorage.setItem(SOUND_KEY, muted ? "off" : "on");
    this.unlock();
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.03);
    if (muted) this.stopLoop();
    else if (this.wanted && this.audible) this.startLoop();
  }

  setAudible(audible: boolean): void {
    this.audible = audible;
    if (!audible) this.stopLoop();
    else if (this.wanted && !this.muted) this.startLoop();
  }

  startMusic(): void {
    this.wanted = true;
    this.unlock();
    if (!this.muted && this.audible) this.startLoop();
  }

  deal(): void {
    this.snap(1800, 0.045);
    this.snap(900, 0.05, 0.04);
  }

  street(): void {
    this.snap(1400, 0.04);
    this.snap(1100, 0.04, 0.06);
    this.snap(800, 0.045, 0.12);
  }

  check(): void {
    this.blip(520, 0.06, "sine", 0.12);
  }

  fold(): void {
    this.thud();
  }

  chips(): void {
    this.blip(1680, 0.07, "square", 0.06);
    this.blip(2100, 0.05, "sine", 0.05, 0.03);
  }

  allIn(): void {
    const ctx = this.ready();
    if (!ctx || !this.fx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(90, now);
    osc.frequency.exponentialRampToValueAtTime(620, now + 0.28);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.2, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
    osc.connect(gain);
    gain.connect(this.fx);
    osc.start(now);
    osc.stop(now + 0.46);
    this.thud();
  }

  yourTurn(): void {
    this.blip(880, 0.08, "triangle", 0.08);
  }

  win(): void {
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, index) => {
      this.blip(freq, 0.16, "triangle", 0.12, index * 0.09);
    });
  }

  lose(): void {
    [392, 311.13, 233.08].forEach((freq, index) => {
      this.blip(freq, 0.2, "sine", 0.1, index * 0.11);
    });
  }

  dispose(): void {
    this.wanted = false;
    this.stopLoop();
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
    this.master = null;
    this.music = null;
    this.fx = null;
  }

  private ready(): AudioContext | null {
    if (this.muted || !this.ctx || !this.fx) return null;
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private startLoop(): void {
    if (!this.ctx || !this.music || this.timer !== null) return;
    this.nextAt = this.ctx.currentTime + 0.06;
    this.pump();
  }

  private stopLoop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private pump = (): void => {
    const ctx = this.ctx;
    const dest = this.music;
    if (!ctx || !dest || this.muted || !this.wanted || !this.audible) {
      this.timer = null;
      return;
    }
    const score = musicById(this.trackId);
    if (!score) {
      this.timer = null;
      return;
    }
    const stepDur = 60 / score.bpm / 4;
    const horizon = ctx.currentTime + 0.7;
    while (this.nextAt < horizon) {
      const step = this.step % score.steps;
      for (const note of score.notes) {
        if (note.step !== step) continue;
        if (note.voice === "hat") this.hat(this.nextAt);
        else if (note.voice === "whip") this.whip(this.nextAt);
        else strike(ctx, dest, this.nextAt, midiHz(note.midi), Math.max(note.dur * stepDur, 0.05), note.type, note.gain);
      }
      this.step += 1;
      this.nextAt += stepDur;
    }
    this.timer = setTimeout(this.pump, Math.max(40, stepDur * 400));
  };

  private blip(freq: number, dur: number, type: OscKind, gain: number, delay = 0): void {
    const ctx = this.ready();
    if (!ctx || !this.fx) return;
    strike(ctx, this.fx, ctx.currentTime + delay, freq, dur, type, gain);
  }

  private snap(freq: number, dur: number, delay = 0): void {
    const ctx = this.ready();
    if (!ctx || !this.fx || !this.noise) return;
    const now = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(freq, now);
    filter.Q.value = 4;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.35, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.fx);
    src.start(now);
    src.stop(now + dur + 0.02);
  }

  private thud(): void {
    const ctx = this.ready();
    if (!ctx || !this.fx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.18);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.28, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc.connect(gain);
    gain.connect(this.fx);
    osc.start(now);
    osc.stop(now + 0.24);
  }

  private whip(when: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.music || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(2400, when);
    filter.frequency.exponentialRampToValueAtTime(380, when + 0.08);
    filter.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(0.22, when + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.09);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.music);
    src.start(when);
    src.stop(when + 0.1);
  }

  private hat(when: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.music || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 4000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(0.08, when + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.music);
    src.start(when);
    src.stop(when + 0.05);
  }
}

function midiHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function strike(ctx: AudioContext, dest: AudioNode, when: number, freq: number, dur: number, type: OscKind, level: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, when);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(Math.max(level, 0.0002), when + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(when);
  osc.stop(when + dur + 0.03);
}

function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

export function handResult(heroStack: number): "win" | "lose" | "chop" {
  const net = heroStack - 10000;
  if (net > 0) return "win";
  if (net < 0) return "lose";
  return "chop";
}
