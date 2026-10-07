"use client";

import { useEffect, useRef, useState } from "react";
import { PokerTable } from "@/components/poker-table";
import { RoomTable } from "@/components/room-table";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { HANDS_PER_MATCH, TIER_LABEL, formatChips, formatElo } from "@/lib/constants";
import type { BotHit, FieldDuel, LadderRow, PracticePool, PracticeSeat, SeatRequest, TableRate } from "@/lib/controller";
import { PRACTICE_GROUPS } from "@/lib/field";
import { HandMachine, positionName, type Act, type Decision } from "@/lib/hand";
import { kaijiDecision } from "@/lib/kaiji";
import { decideBot, type Bot } from "@/lib/policy";
import { Rng, hashString } from "@/lib/rng";
import { TableAudio, handResult } from "@/lib/table-audio";
import { cleanRoomCode, streetLabel, visibleHole, type TableView } from "@/lib/table-view";

const STREETS = ["Preflop", "Flop", "Turn", "River"];
const ZERO = [0, 0, 0, 0, 0, 0];

interface SeatDraft {
  pool: PracticePool;
  botId: string | null;
  pickedName: string;
  query: string;
}

function emptyDraft(): SeatDraft {
  return { pool: "random", botId: null, pickedName: "", query: "" };
}

export function SixMax({
  blinds,
  locked,
  seed,
  players,
  ladder,
  fieldDuels,
  yourElo,
  seatFive,
  findPlayers,
  liveRatings,
  rateTable,
  tickField,
  bots,
}: {
  blinds: boolean;
  locked: boolean;
  seed: string;
  players: number;
  ladder: LadderRow[];
  fieldDuels: FieldDuel[];
  yourElo: number;
  seatFive: (requests: SeatRequest[]) => { seats: PracticeSeat[] | null; error: string | null };
  findPlayers: (query: string) => BotHit[];
  liveRatings: (botId: string | null) => { own: number; you: number };
  rateTable: (opponents: { botId: string | null }[], nets: number[]) => TableRate | null;
  tickField: (excludeIds: string[]) => void;
  bots: () => Bot[];
}) {
  const rng = useRef(new Rng(hashString(`kaiji-six-max:${seed}`)));
  const handRef = useRef<HandMachine | null>(null);
  const accounted = useRef(false);
  const [tick, setTick] = useState(0);
  const [nets, setNets] = useState<number[]>(ZERO);
  const [dealt, setDealt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sizing, setSizing] = useState<number[] | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const audio = useRef<TableAudio | null>(null);
  const heardTurn = useRef(false);
  const rootRef = useRef<HTMLElement | null>(null);
  const actionRef = useRef<HTMLDivElement | null>(null);
  const pendingScroll = useRef(false);
  const seatsRef = useRef<(PracticeSeat | null)[]>([null, null, null, null, null]);
  const [seats, setSeats] = useState<(PracticeSeat | null)[]>([null, null, null, null, null]);
  const [mode, setMode] = useState<"random" | "choose">("random");
  const [play, setPlay] = useState<"solo" | "host" | "join">("solo");
  const [joinCode, setJoinCode] = useState("");
  const playRef = useRef(play);
  playRef.current = play;
  const [drafts, setDrafts] = useState<SeatDraft[]>(() => Array.from({ length: 5 }, emptyDraft));
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const [rateNote, setRateNote] = useState<string | null>(null);
  const matchHands = useRef(0);
  const netsRef = useRef<number[]>([0, 0, 0, 0, 0, 0]);
  const visibleRef = useRef(false);
  const tickRef = useRef(tickField);
  const seatFiveRef = useRef(seatFive);
  const liveRef = useRef(liveRatings);
  const rateRef = useRef(rateTable);
  const yourEloRef = useRef(yourElo);
  const modeRef = useRef(mode);
  const draftsRef = useRef(drafts);
  tickRef.current = tickField;
  seatFiveRef.current = seatFive;
  liveRef.current = liveRatings;
  rateRef.current = rateTable;
  yourEloRef.current = yourElo;
  modeRef.current = mode;
  draftsRef.current = drafts;
  if (!audio.current && typeof window !== "undefined") audio.current = new TableAudio();
  const refresh = () => setTick((value) => value + 1);

  useEffect(() => {
    const table = audio.current ?? new TableAudio();
    audio.current = table;
    setSoundOn(!table.muted);
    const node = rootRef.current;
    const observer = node
      ? new IntersectionObserver(
          ([entry]) => {
            visibleRef.current = entry.isIntersecting;
            table.setAudible(entry.isIntersecting);
          },
          { threshold: 0 },
        )
      : null;
    if (node && observer) observer.observe(node);
    return () => {
      observer?.disconnect();
      table.dispose();
      audio.current = null;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (playRef.current !== "solo" || !visibleRef.current) return;
      const ids = seatsRef.current.flatMap((seat) => (seat?.botId ? [seat.botId] : []));
      tickRef.current(ids);
    }, 900);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    handRef.current = null;
    seatsRef.current = [null, null, null, null, null];
    setSeats([null, null, null, null, null]);
    matchHands.current = 0;
    netsRef.current = ZERO.slice();
    setNets(ZERO.slice());
    setDealt(0);
    setRateNote(null);
    setSizing(null);
    setError(null);
    setDrafts(Array.from({ length: 5 }, emptyDraft));
    setOpenMenu(null);
    rng.current = new Rng(hashString(`kaiji-six-max:${seed}`));
    const hashed = window.location.hash.match(/^#table-([A-HJ-NP-Z2-9]{5})$/);
    if (hashed) {
      setPlay("join");
      setJoinCode(cleanRoomCode(hashed[1]));
    }
    refresh();
  }, [seed, players]);

  const hand = handRef.current;

  useEffect(() => {
    const current = handRef.current;
    if (!current || current.phase !== "next-street") return;
    const timer = window.setTimeout(() => {
      const live = handRef.current;
      if (!live || live.phase !== "next-street") return;
      try {
        live.advance();
        audio.current?.street();
        settle(live);
        refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The deal failed.");
      }
    }, 520);
    return () => window.clearTimeout(timer);
  }, [tick]);

  useEffect(() => {
    const current = handRef.current;
    if (!current || current.phase !== "act" || current.actor <= 0) return;
    const actor = current.actor;
    const timer = window.setTimeout(() => {
      const live = handRef.current;
      if (!live || live.phase !== "act" || live.actor !== actor) return;
      try {
        const ctx = live.fillCtx(actor);
        const decision = decideFor(actor, ctx);
        live.act(actor, decision);
        voice(decision.act, live);
        settle(live);
        refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "A player could not act.");
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [tick]);

  function settle(current: HandMachine | null) {
    if (!current || current.phase !== "done" || accounted.current) return;
    accounted.current = true;
    const next = netsRef.current.map((net, index) => net + current.stack[index] - 10000);
    matchHands.current += 1;
    if (matchHands.current >= HANDS_PER_MATCH) {
      const opponents = seatsRef.current.map((seat) => ({ botId: seat?.botId ?? null }));
      const rated = opponents.every((seat, index) => seatsRef.current[index])
        ? rateRef.current(opponents, next)
        : null;
      matchHands.current = 0;
      netsRef.current = ZERO.slice();
      setNets(ZERO.slice());
      setDealt(0);
      setRateNote(
        rated
          ? `Match rated. You ${formatElo(rated.you)} (${signedElo(rated.youDelta)}). ${rated.seats.map((seat) => `${seat.name} ${signedElo(seat.delta)}`).join(", ")}.`
          : "This run is locked, so that match was not rated.",
      );
    } else {
      netsRef.current = next;
      setNets(next);
      setDealt(matchHands.current);
    }
    const result = handResult(current.stack[0]);
    if (result === "win") audio.current?.win();
    else if (result === "lose") audio.current?.lose();
  }

  function voice(actName: Act, current: HandMachine) {
    if (actName === "allin") audio.current?.allIn();
    else if (actName === "fold") audio.current?.fold();
    else if (current.phase === "done") return;
    else if (actName === "check") audio.current?.check();
    else audio.current?.chips();
  }

  function decideFor(actor: number, ctx: ReturnType<HandMachine["fillCtx"]>): Decision {
    const player = seatsRef.current[actor - 1];
    if (!player || player.usesKaiji || !player.bot) {
      return kaijiDecision(ctx.hole0, ctx.hole1, ctx.board, ctx.street, ctx.toCall);
    }
    const ratings = [yourEloRef.current];
    for (const seat of seatsRef.current) ratings.push(seat ? liveRef.current(seat.botId).own : 1500);
    let sum = 0;
    for (let i = 0; i < ratings.length; i++) if (i !== actor) sum += ratings[i];
    ctx.ownElo = ratings[actor] ?? 1500;
    ctx.oppAvgElo = sum / Math.max(1, ratings.length - 1);
    return decideBot(player.bot, ctx, () => rng.current.next());
  }

  function seatTable(): boolean {
    const requests: SeatRequest[] =
      modeRef.current === "random"
        ? Array.from({ length: 5 }, () => ({ pool: "random", botId: null }))
        : draftsRef.current.map((draft) => ({ pool: draft.pool, botId: draft.botId }));
    const drawn = seatFiveRef.current(requests);
    if (!drawn.seats || drawn.seats.length !== 5) {
      setError(drawn.error ?? "The table could not be seated.");
      return false;
    }
    if (matchHands.current > 0) {
      setRateNote(`${matchHands.current} of ${HANDS_PER_MATCH} hands is not a rated match.`);
    }
    seatsRef.current = drawn.seats;
    setSeats(drawn.seats);
    matchHands.current = 0;
    netsRef.current = ZERO.slice();
    setNets(ZERO.slice());
    setDealt(0);
    return true;
  }

  function deal(rematch = false) {
    if (rematch || seatsRef.current.some((seat) => !seat)) {
      if (!seatTable()) return;
    }
    setError(null);
    setSizing(null);
    setOpenMenu(null);
    accounted.current = false;
    heardTurn.current = false;
    audio.current?.unlock();
    audio.current?.startMusic();
    audio.current?.deal();
    handRef.current = new HandMachine({
      n: 6,
      button: matchHands.current % 6,
      blinds,
      rng: rng.current,
      keepLog: true,
    });
    pendingScroll.current = true;
    refresh();
  }

  function act(decision: Decision) {
    const current = handRef.current;
    if (!current || current.phase !== "act" || current.actor !== 0) return;
    try {
      current.act(0, decision);
      voice(decision.act, current);
      setSizing(null);
      settle(current);
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That action was refused.");
    }
  }

  function updateDraft(index: number, patch: Partial<SeatDraft>) {
    setDrafts((current) => current.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));
  }

  const yourTurn = Boolean(hand && hand.phase === "act" && hand.actor === 0);
  useEffect(() => {
    if (yourTurn && !heardTurn.current) audio.current?.yourTurn();
    heardTurn.current = yourTurn;
  }, [yourTurn, tick]);
  useEffect(() => {
    if (!handRef.current) return;
    if (pendingScroll.current) {
      pendingScroll.current = false;
      document.querySelector("[data-your-cards]")?.scrollIntoView({ block: "center" });
    }
    if (yourTurn) actionRef.current?.scrollIntoView({ block: "nearest" });
  }, [yourTurn, tick]);
  const legal = yourTurn && hand ? hand.legal(0) : null;
  const street = hand ? STREETS[hand.street] ?? "Showdown" : "Waiting";
  const takenIds = new Set(drafts.flatMap((draft) => (draft.botId ? [draft.botId] : [])));

  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    audio.current?.setMuted(!next);
    if (next && handRef.current) audio.current?.startMusic();
  }

  function eloOf(seat: PracticeSeat | null): number {
    return seat ? liveRatings(seat.botId).own : 1500;
  }

  const soloPhase: TableView["phase"] = !hand ? "lobby" : hand.phase === "done" ? "show" : "act";
  const soloView: TableView = {
    phase: soloPhase,
    yourSeat: 0,
    button: hand?.button ?? 0,
    actor: hand && hand.phase === "act" ? hand.actor : -1,
    pot: hand?.pot ?? 0,
    board: hand?.board ?? [],
    streetLabel: streetLabel(hand?.street ?? 0, soloPhase),
    lastAction: hand?.lastAction ?? "",
    seats: Array.from({ length: 6 }, (_, index) => {
      if (index === 0) {
        return {
          name: "You",
          stack: hand?.stack[0] ?? 10000,
          folded: Boolean(hand?.folded[0]),
          allin: Boolean(hand?.allin[0]),
          empty: false,
          human: true,
          isYou: true,
          away: false,
          cards: visibleHole(hand ? hand.hole[0] : null, Boolean(hand), Boolean(hand?.showdown), Boolean(hand?.folded[0])),
          detail: hand ? positionName((6 - (hand.button % 6)) % 6, 6) : "You",
        };
      }
      const seat = seats[index - 1];
      return {
        name: seat?.name ?? "Open",
        stack: hand ? hand.stack[index] : 0,
        folded: Boolean(hand?.folded[index]),
        allin: Boolean(hand?.allin[index]),
        empty: !seat,
        human: false,
        isYou: false,
        away: false,
        cards: visibleHole(hand && seat ? hand.hole[index] : null, false, Boolean(hand?.showdown), Boolean(hand?.folded[index])),
        detail: seat && hand ? `${positionName((index - hand.button + 6) % 6, 6)} · ${formatElo(eloOf(seat))}` : "Empty chair",
      };
    }),
  };

  return (
    <section ref={rootRef} data-testid="six-max" className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2">
        <Button type="button" className="min-h-11" variant={play === "solo" ? "default" : "outline"} aria-pressed={play === "solo"} onClick={() => setPlay("solo")}>
          Solo
        </Button>
        <Button type="button" className="min-h-11" variant={play === "host" ? "default" : "outline"} aria-pressed={play === "host"} onClick={() => setPlay("host")}>
          Host
        </Button>
        <Button type="button" className="min-h-11" variant={play === "join" ? "default" : "outline"} aria-pressed={play === "join"} onClick={() => setPlay("join")}>
          Join
        </Button>
      </div>
      {play !== "solo" ? (
        <>
          <div className={play === "host" ? "contents" : "hidden"}>
            <RoomTable role="host" active={play === "host"} blinds={blinds} bots={bots} />
          </div>
          <div className={play === "join" ? "contents" : "hidden"}>
            <RoomTable role="guest" active={play === "join"} initialCode={joinCode} blinds={blinds} bots={bots} />
          </div>
        </>
      ) : (
      <>
      <div className={`order-3 lg:order-none ${hand && hand.phase !== "done" ? "max-lg:hidden" : ""}`}>
      <TableSetup
        mode={mode}
        setMode={setMode}
        drafts={drafts}
        openMenu={openMenu}
        setOpenMenu={setOpenMenu}
        takenIds={takenIds}
        findPlayers={findPlayers}
        onDraft={updateDraft}
        seated={seats}
        showDeal={!hand}
        onDeal={() => deal()}
      />
      </div>
      <div className="order-4 lg:order-none">
      <LiveLadder ladder={ladder} duels={fieldDuels} locked={locked} yourElo={yourElo} seats={seats} />
      </div>
      <div className="order-2 grid gap-4 lg:order-none lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex flex-col gap-3">
          <PokerTable view={soloView} />
          <div ref={actionRef} className="sticky bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-20 rounded-xl border border-black/50 bg-[#101010]/95 p-2 backdrop-blur">
            {error ? <p className="mb-2 text-sm text-[#ffb4b4]">{error}</p> : null}
            {!hand ? (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button className="min-h-12" size="lg" onClick={() => deal()}>
                  Deal the hand
                </Button>
                <SoundButton on={soundOn} onToggle={toggleSound} />
              </div>
            ) : null}
            {hand && hand.phase === "done" ? (
              <div className="grid grid-cols-2 gap-2">
                <Button className="min-h-12 text-base" variant="outline" onClick={() => deal(true)}>
                  New table
                </Button>
                <Button className="min-h-12 text-base" onClick={() => deal()}>
                  Next hand
                </Button>
              </div>
            ) : null}
            {yourTurn && legal ? (
              <div className="grid grid-cols-2 gap-2">
                {legal.canFold ? (
                  <Button className="min-h-12 text-base" variant="outline" onClick={() => act({ act: "fold" })}>
                    Fold
                  </Button>
                ) : null}
                {legal.canCheck ? (
                  <Button className="min-h-12 text-base" variant="outline" onClick={() => act({ act: "check" })}>
                    Check
                  </Button>
                ) : null}
                {legal.canCall ? (
                  <Button className="min-h-12 text-base" onClick={() => act({ act: "call" })}>
                    Call {legal.toCall.toLocaleString("en-US")}
                  </Button>
                ) : null}
                {legal.canBet ? (
                  <Button className="min-h-12 text-base" variant="secondary" onClick={() => setSizing([legal.minBetTo])}>
                    Bet
                  </Button>
                ) : null}
                {legal.canRaise ? (
                  <Button className="min-h-12 text-base" variant="secondary" onClick={() => setSizing([legal.minRaiseTo])}>
                    Raise
                  </Button>
                ) : null}
                <Button className="col-span-2 min-h-12 text-base" onClick={() => act({ act: "allin" })}>
                  All-in {legal.maxTo.toLocaleString("en-US")}
                </Button>
              </div>
            ) : null}
            {sizing && legal ? (
              <div className="mt-2">
                <p className="mb-2 text-sm text-[#f6efe2]">To {sizing[0]?.toLocaleString("en-US")} chips this street</p>
                <Slider
                  min={legal.canBet ? legal.minBetTo : legal.minRaiseTo}
                  max={legal.maxTo}
                  step={50}
                  value={sizing}
                  onValueChange={(value) => setSizing(Array.isArray(value) ? [...value] : [value])}
                />
                <Button
                  className="mt-3 min-h-12 w-full text-base"
                  onClick={() => act(legal.canBet ? { act: "bet", to: sizing[0] } : { act: "raise", to: sizing[0] })}
                >
                  Confirm
                </Button>
              </div>
            ) : null}
            {hand && !yourTurn && hand.phase !== "done" ? (
              <p className="text-center text-sm text-[#d5c7ae]">
                {hand.phase === "act"
                  ? `${seats[hand.actor - 1]?.name ?? "The table"} has the action.`
                  : "The next card is coming."}
              </p>
            ) : null}
          </div>
        </div>


        <aside className="flex flex-col gap-3">
          <div className="rounded-xl border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Session chips</p>
              <SoundButton on={soundOn} onToggle={toggleSound} />
            </div>
            <p className="mt-1 text-sm">
              You {formatChips(nets[0] ?? 0)} · {formatElo(yourElo)}
            </p>
            <ul className="mt-1 space-y-1">
              {seats.map((seat, index) => (
                <li key={seat?.botId ?? `open-${index}`} className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">{seat?.name ?? `Chair ${index + 1}`}</span>
                  <span className="shrink-0 tabular-nums">
                    {formatChips(nets[index + 1] ?? 0)}
                    {seat ? ` · ${formatElo(eloOf(seat))}` : ""}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Match hand {dealt} / {HANDS_PER_MATCH}. Ratings move when the 240th hand ends. New table starts the chips over and leaves a short sit unrated.
              {locked ? " This run is locked, so nothing here changes the ladder." : " The field plays its own matches beside you."}
            </p>
            {rateNote ? <p className="mt-2 text-sm text-foreground">{rateNote}</p> : null}
          </div>
        </aside>
      </div>
      </>
      )}
    </section>
  );
}

function TableSetup({
  mode,
  setMode,
  drafts,
  openMenu,
  setOpenMenu,
  takenIds,
  findPlayers,
  onDraft,
  seated,
  showDeal,
  onDeal,
}: {
  mode: "random" | "choose";
  setMode: (mode: "random" | "choose") => void;
  drafts: SeatDraft[];
  openMenu: number | null;
  setOpenMenu: (index: number | null) => void;
  takenIds: Set<string>;
  findPlayers: (query: string) => BotHit[];
  onDraft: (index: number, patch: Partial<SeatDraft>) => void;
  seated: (PracticeSeat | null)[];
  showDeal: boolean;
  onDeal: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (openMenu === null) return;
    function onPointer(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpenMenu(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenMenu(null);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [openMenu, setOpenMenu]);

  const seatedNames = seated.flatMap((seat) => (seat ? [seat.name] : []));

  return (
    <div ref={menuRef} className="rounded-xl border bg-card p-3">
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Table</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button type="button" className="min-h-11" variant={mode === "random" ? "default" : "outline"} aria-pressed={mode === "random"} onClick={() => setMode("random")}>
          Random five
        </Button>
        <Button type="button" className="min-h-11" variant={mode === "choose" ? "default" : "outline"} aria-pressed={mode === "choose"} onClick={() => setMode("choose")}>
          Choose seats
        </Button>
      </div>
      {showDeal ? (
        <Button id="six-max-deal" type="button" className="mt-2 min-h-12 w-full text-base" onClick={onDeal}>
          Deal the hand
        </Button>
      ) : null}
      {mode === "choose" ? (
        <div className="mt-3 grid gap-3">
          {drafts.map((draft, index) => {
            const hits = draft.query.trim()
              ? findPlayers(draft.query).filter((hit) => hit.id === draft.botId || !takenIds.has(hit.id)).slice(0, 6)
              : [];
            return (
              <div key={index} className="rounded-lg border border-border/80 p-2">
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Chair {index + 1}</p>
                <button
                  type="button"
                  aria-expanded={openMenu === index}
                  aria-haspopup="listbox"
                  className="mt-2 flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-input bg-[#221812] px-2.5 text-left text-base text-[#f3e6d0]"
                  onClick={() => setOpenMenu(openMenu === index ? null : index)}
                >
                  <span className="truncate">{draft.botId ? draft.pickedName : poolLabel(draft.pool)}</span>
                  <span aria-hidden="true" className="text-[#e2b657]">{openMenu === index ? "▴" : "▾"}</span>
                </button>
                {openMenu === index ? (
                  <div role="listbox" className="mt-2 max-h-60 overflow-auto rounded-lg border border-[#4a382c] bg-[#221812] p-1">
                    <PoolChoice selected={draft.pool === "random" && !draft.botId} label="Random player" onPick={() => { onDraft(index, { pool: "random", botId: null, pickedName: "", query: "" }); setOpenMenu(null); }} />
                    <PoolChoice selected={draft.pool === "kaiji" && !draft.botId} label="Kaiji" onPick={() => { onDraft(index, { pool: "kaiji", botId: null, pickedName: "", query: "" }); setOpenMenu(null); }} />
                    <PoolChoice selected={draft.pool === "kaiji-chart" && !draft.botId} label="Kaiji chart copies" onPick={() => { onDraft(index, { pool: "kaiji-chart", botId: null, pickedName: "", query: "" }); setOpenMenu(null); }} />
                    {PRACTICE_GROUPS.map((group) => (
                      <div key={group.tier}>
                        <p className="px-2 pt-2 text-[10px] uppercase tracking-[0.16em] text-[#c4b39a]">{TIER_LABEL[group.tier]}</p>
                        <PoolChoice
                          selected={draft.pool === group.tier && !draft.botId}
                          label={`Any ${TIER_LABEL[group.tier]}`}
                          onPick={() => { onDraft(index, { pool: group.tier, botId: null, pickedName: "", query: "" }); setOpenMenu(null); }}
                        />
                        {group.personalities.length > 1
                          ? group.personalities.map((name) => (
                              <PoolChoice
                                key={name}
                                selected={draft.pool === `style:${name}` && !draft.botId}
                                label={name}
                                onPick={() => { onDraft(index, { pool: `style:${name}`, botId: null, pickedName: "", query: "" }); setOpenMenu(null); }}
                              />
                            ))
                          : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                {draft.botId ? (
                  <button
                    type="button"
                    className="mt-2 min-h-11 text-sm text-[#e2b657]"
                    onClick={() => onDraft(index, { botId: null, pickedName: "", query: "" })}
                  >
                    Clear {draft.pickedName}
                  </button>
                ) : (
                  <input
                    value={draft.query}
                    placeholder="Or type a name"
                    aria-label={`Name for chair ${index + 1}`}
                    className="mt-2 min-h-11 w-full rounded-lg border border-input bg-[#221812] px-2.5 text-base text-[#f3e6d0] outline-none placeholder:text-[#c4b39a]"
                    onChange={(event) => onDraft(index, { query: event.target.value })}
                  />
                )}
                {hits.length > 0 ? (
                  <div className="mt-1 max-h-40 overflow-auto rounded-lg border border-[#4a382c] bg-[#221812]">
                    {hits.map((hit) => (
                      <button
                        key={hit.id}
                        type="button"
                        className="flex min-h-11 w-full items-center justify-between gap-2 px-2 text-left text-sm text-[#f3e6d0]"
                        onClick={() => onDraft(index, { botId: hit.id, pickedName: hit.name, query: "" })}
                      >
                        <span className="truncate">{hit.name}</span>
                        <span className="shrink-0 text-[#c4b39a]">{hit.style}</span>
                      </button>
                    ))}
                  </div>
                ) : draft.query.trim() ? (
                  <p className="mt-1 text-xs text-[#c4b39a]">No player matches.</p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      <p className="mt-2 text-sm">
        {seatedNames.length === 5 ? (
          <>At the table: {seatedNames.join(", ")}</>
        ) : (
          <span className="text-muted-foreground">No one is seated yet.</span>
        )}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Random five draws anyone in the field, including chart copies. Choose seats sets each chair to a style, a personality, or a typed name. Kaiji himself is in the list and can sit only once. Next hand keeps these five. New table draws the chairs again.
      </p>
    </div>
  );
}

function poolLabel(pool: PracticePool): string {
  if (pool === "random") return "Random player";
  if (pool === "kaiji") return "Kaiji";
  if (pool === "kaiji-chart") return "Kaiji chart copies";
  if (pool.startsWith("style:")) return pool.slice("style:".length);
  return `Any ${TIER_LABEL[pool as keyof typeof TIER_LABEL]}`;
}

function PoolChoice({ selected, label, onPick }: { selected: boolean; label: string; onPick: () => void }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={`flex min-h-11 w-full items-center rounded-md px-2 text-left text-base ${selected ? "bg-[#3a2c22] text-[#e2b657]" : "text-[#f3e6d0]"}`}
      onClick={onPick}
    >
      {label}
    </button>
  );
}

function signedElo(delta: number): string {
  const rounded = Math.round(delta);
  if (rounded > 0) return `+${rounded.toLocaleString("en-US")}`;
  return rounded.toLocaleString("en-US");
}

function LiveLadder({
  ladder,
  duels,
  locked,
  yourElo,
  seats,
}: {
  ladder: LadderRow[];
  duels: FieldDuel[];
  locked: boolean;
  yourElo: number;
  seats: (PracticeSeat | null)[];
}) {
  const watch = new Set<string>(["you"]);
  for (const seat of seats) {
    if (!seat) continue;
    watch.add(seat.botId ?? "kaiji");
  }
  const rows = ladder.slice(0, 8);
  const pinned = ladder.filter((row) => watch.has(row.id) && !rows.some((shown) => shown.id === row.id));
  const latest = duels[0];
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Ladder</p>
        <p className="text-sm">You {formatElo(yourElo)}</p>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {locked
          ? "The run is locked. Field matches are paused."
          : latest
            ? `${latest.aName} ${formatElo(latest.aElo)} (${signedElo(latest.aDelta)}) vs ${latest.bName} ${formatElo(latest.bElo)} (${signedElo(latest.bDelta)})`
            : "The field is about to play. Ratings move as those matches finish."}
      </p>
      <ul className="mt-2 grid gap-1 sm:grid-cols-2">
        {[...rows, ...pinned].map((row) => (
          <li key={row.id} className="flex items-baseline justify-between gap-2 text-sm">
            <span className="min-w-0 truncate">
              <span className="text-muted-foreground">{row.rank} </span>
              {row.name}
              <span className="text-muted-foreground"> · {row.style}</span>
            </span>
            <span className="shrink-0 tabular-nums">{formatElo(row.elo)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SoundButton({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <Button type="button" className="min-h-11" variant={on ? "default" : "outline"} onClick={onToggle}>
      {on ? "Sound on" : "Sound off"}
    </Button>
  );
}
