const MUSIC_KEY = "texas-poker-kaiji-music";

export type MusicVoice = "tone" | "hat" | "whip";

export interface MusicNote {
  step: number;
  midi: number;
  /** Length in sixteenth notes. */
  dur: number;
  type: OscillatorType;
  gain: number;
  voice: MusicVoice;
}

export interface MusicTrack {
  id: string;
  name: string;
  /** Table groove, or an original gothic organ piece. */
  style: "Table" | "Castle";
  bpm: number;
  steps: number;
  notes: MusicNote[];
}

/**
 * Original scores synthesized in the browser. The castle pieces borrow the
 * feel of a gothic chiptune (minor organ, leaping square lead, a whip on the
 * backbeat). They are not transcriptions of any published game soundtrack.
 */
export const MUSIC_TRACKS: readonly MusicTrack[] = [
  feltPulse(),
  nightChapel(),
  ironStaircase(),
  candleWaltz(),
  lastBell(),
  pitLantern(),
];

const TRACK_BY_ID = new Map(MUSIC_TRACKS.map((track) => [track.id, track]));

export function musicById(id: string): MusicTrack | null {
  return TRACK_BY_ID.get(id) ?? null;
}

export function resolveMusicId(id: string): string {
  return TRACK_BY_ID.has(id) ? id : MUSIC_TRACKS[0].id;
}

export function musicName(id: string): string {
  return (TRACK_BY_ID.get(resolveMusicId(id)) ?? MUSIC_TRACKS[0]).name;
}

export function savedMusicId(): string {
  if (typeof localStorage === "undefined") return MUSIC_TRACKS[0].id;
  return resolveMusicId(localStorage.getItem(MUSIC_KEY) ?? "");
}

export function rememberMusic(id: string): string {
  const next = resolveMusicId(id);
  if (typeof localStorage !== "undefined") localStorage.setItem(MUSIC_KEY, next);
  return next;
}

function tone(step: number, midi: number, dur: number, type: OscillatorType, gain: number): MusicNote {
  return { step, midi, dur, type, gain, voice: "tone" };
}

function crack(step: number, voice: "hat" | "whip"): MusicNote {
  return { step, midi: 0, dur: 1, type: "square", gain: 0, voice };
}

function organ(step: number, root: number, dur: number, gain = 0.12): MusicNote[] {
  return [
    tone(step, root, dur, "triangle", gain),
    tone(step, root - 12, dur, "sine", gain * 0.7),
    tone(step, root + 7, dur, "triangle", gain * 0.45),
  ];
}

/** The original table pulse: a low D loop with a hat on the off-beats. */
function feltPulse(): MusicTrack {
  const bass = [38, 38, 41, 38, 33, 38, 36, 43];
  const notes: MusicNote[] = [];
  bass.forEach((midi, index) => {
    const step = index * 4;
    notes.push(tone(step, midi, 3.2, "triangle", 0.22));
    notes.push(tone(step, midi - 12, 3.4, "sine", 0.14));
    if (index % 2 === 1) notes.push(crack(step, "hat"));
    if (index === 4) {
      notes.push(tone(step, midi + 19, 2, "square", 0.04));
      notes.push(tone(step, midi + 24, 1.6, "square", 0.035));
    }
  });
  return { id: "felt-pulse", name: "Felt Pulse", style: "Table", bpm: 200, steps: 32, notes };
}

/** B minor organ march. The lead leaps instead of walking the scale. */
function nightChapel(): MusicTrack {
  const notes: MusicNote[] = [
    ...organ(0, 35, 6),
    ...organ(8, 42, 4),
    ...organ(16, 33, 6),
    ...organ(24, 40, 4),
    tone(0, 74, 1.4, "square", 0.07),
    tone(2, 71, 1.2, "square", 0.06),
    tone(4, 78, 1.4, "square", 0.07),
    tone(6, 74, 1.2, "square", 0.06),
    tone(8, 76, 1.2, "square", 0.06),
    tone(10, 73, 1.2, "square", 0.055),
    tone(12, 71, 1.6, "square", 0.06),
    tone(16, 69, 1.2, "square", 0.055),
    tone(18, 71, 1.2, "square", 0.06),
    tone(20, 74, 1.2, "square", 0.065),
    tone(22, 78, 1.4, "square", 0.07),
    tone(24, 81, 1.6, "square", 0.07),
    tone(26, 78, 1.2, "square", 0.06),
    tone(28, 76, 1.2, "square", 0.055),
    tone(30, 74, 1.4, "square", 0.05),
    crack(4, "whip"),
    crack(12, "whip"),
    crack(20, "whip"),
    crack(28, "whip"),
    crack(2, "hat"),
    crack(6, "hat"),
    crack(10, "hat"),
    crack(14, "hat"),
  ];
  return { id: "night-chapel", name: "Night Chapel", style: "Castle", bpm: 138, steps: 32, notes };
}

/** G minor, faster, with a climbing bass and a whip on every other beat. */
function ironStaircase(): MusicTrack {
  const bass = [31, 31, 34, 34, 38, 38, 29, 29, 36, 36, 39, 39, 38, 38, 31, 31];
  const lead = [67, 70, 74, 77, 79, 77, 74, 72, 70, 74, 77, 82, 79, 77, 74, 70];
  const notes: MusicNote[] = [];
  bass.forEach((midi, index) => {
    notes.push(tone(index * 2, midi, 1.6, "square", 0.1));
    notes.push(tone(index * 2, midi - 12, 1.6, "sine", 0.08));
  });
  lead.forEach((midi, index) => {
    notes.push(tone(index * 2 + 1, midi, 1.1, "square", 0.055));
  });
  for (const step of [4, 12, 20, 28]) notes.push(crack(step, "whip"));
  for (const step of [2, 6, 10, 14, 18, 22, 26, 30]) notes.push(crack(step, "hat"));
  return { id: "iron-staircase", name: "Iron Staircase", style: "Castle", bpm: 168, steps: 32, notes };
}

/** A 3/4 harpsichord waltz in D minor. Two bars, twelve sixteenths each. */
function candleWaltz(): MusicTrack {
  const notes: MusicNote[] = [
    ...organ(0, 50, 5, 0.1),
    ...organ(6, 46, 5, 0.09),
    ...organ(12, 43, 5, 0.09),
    ...organ(18, 45, 5, 0.1),
    tone(0, 69, 2, "square", 0.06),
    tone(3, 65, 2, "square", 0.05),
    tone(6, 74, 2.4, "square", 0.06),
    tone(9, 73, 2, "square", 0.05),
    tone(12, 74, 2, "square", 0.06),
    tone(15, 69, 2, "square", 0.05),
    tone(18, 77, 2.2, "square", 0.055),
    tone(21, 74, 2, "square", 0.05),
    crack(6, "whip"),
    crack(18, "whip"),
  ];
  return { id: "candle-waltz", name: "Candle Waltz", style: "Castle", bpm: 108, steps: 24, notes };
}

/** E phrygian drone. Sparse lead, a bell on the half bar. */
function lastBell(): MusicTrack {
  const notes: MusicNote[] = [
    tone(0, 28, 14, "sine", 0.16),
    tone(0, 40, 14, "triangle", 0.08),
    tone(16, 28, 14, "sine", 0.16),
    tone(16, 35, 14, "triangle", 0.07),
    tone(0, 65, 2, "square", 0.06),
    tone(4, 64, 2, "square", 0.055),
    tone(8, 70, 3, "triangle", 0.07),
    tone(12, 68, 2, "square", 0.05),
    tone(16, 67, 2, "square", 0.055),
    tone(20, 65, 2, "square", 0.05),
    tone(24, 64, 3, "triangle", 0.06),
    tone(28, 61, 3, "square", 0.05),
    crack(8, "whip"),
    crack(24, "whip"),
    crack(0, "hat"),
    crack(16, "hat"),
  ];
  return { id: "last-bell", name: "Last Bell", style: "Castle", bpm: 120, steps: 32, notes };
}

/** C minor lantern march, slower than the staircase, with open fifths. */
function pitLantern(): MusicTrack {
  const notes: MusicNote[] = [
    ...organ(0, 36, 7),
    ...organ(8, 41, 7),
    ...organ(16, 43, 7),
    ...organ(24, 41, 7),
    tone(0, 72, 2, "square", 0.06),
    tone(4, 75, 2, "square", 0.055),
    tone(8, 79, 3, "square", 0.06),
    tone(12, 77, 2, "square", 0.05),
    tone(16, 75, 2, "square", 0.055),
    tone(20, 72, 2, "square", 0.05),
    tone(24, 70, 2, "square", 0.05),
    tone(28, 72, 3, "square", 0.055),
    crack(8, "whip"),
    crack(24, "whip"),
    crack(4, "hat"),
    crack(12, "hat"),
    crack(20, "hat"),
    crack(28, "hat"),
  ];
  return { id: "pit-lantern", name: "Pit Lantern", style: "Castle", bpm: 126, steps: 32, notes };
}
