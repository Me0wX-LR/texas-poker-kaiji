export const TABLE_SEATS = 6;

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function makeRoomCode(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]).join("");
}

export function cleanRoomCode(value: string): string {
  return value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 5);
}

export function cleanPlayerName(value: string): string {
  const name = value.replace(/\s+/g, " ").trim().slice(0, 18);
  return name || "Player";
}

/** One line for the table chat. Blank after cleaning means "do not send". */
export function cleanChatText(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
}

export interface SeatSpot {
  slot: number;
  /** Percent from the left of the scene. */
  x: number;
  /** Percent from the top of the scene. */
  y: number;
}

/** Seat `yourSeat` is always the near chair at the bottom of the oval. */
export function seatSpot(seat: number, yourSeat: number, n = TABLE_SEATS): SeatSpot {
  const slot = ((seat - yourSeat) % n + n) % n;
  const angle = Math.PI / 2 + (slot * 2 * Math.PI) / n;
  return {
    slot,
    x: 50 + Math.cos(angle) * 36,
    y: 50 + Math.sin(angle) * 30,
  };
}

export type HoleView = number[] | "back" | "muck";

export function visibleHole(
  hole: number[] | null,
  viewerIsSeat: boolean,
  showdown: boolean,
  folded: boolean,
): HoleView {
  if (viewerIsSeat && hole) return hole;
  if (folded || !hole) return folded ? "muck" : "back";
  if (showdown) return hole;
  return "back";
}

export interface SeatView {
  name: string;
  stack: number;
  folded: boolean;
  allin: boolean;
  empty: boolean;
  human: boolean;
  isYou: boolean;
  away: boolean;
  cards: HoleView;
  detail: string;
}

export interface TableView {
  phase: "lobby" | "act" | "show";
  yourSeat: number;
  button: number;
  actor: number;
  pot: number;
  board: number[];
  streetLabel: string;
  lastAction: string;
  seats: SeatView[];
}

export function turnText(view: Pick<TableView, "phase" | "actor" | "yourSeat" | "seats">): string {
  if (view.phase === "lobby") return "Take a seat";
  if (view.phase === "show" || view.actor < 0) return view.phase === "show" ? "Hand over" : "Dealing";
  const actor = view.seats[view.actor];
  if (actor?.away) return `${actor.name} disconnected`;
  if (view.actor === view.yourSeat) return "Your turn";
  return `${actor?.name || "Player"} to act`;
}

const STREETS = ["Preflop", "Flop", "Turn", "River"];

export function streetLabel(street: number, phase: TableView["phase"]): string {
  if (phase === "lobby") return "Waiting";
  if (phase === "show") return "Showdown";
  return STREETS[street] ?? "Showdown";
}
