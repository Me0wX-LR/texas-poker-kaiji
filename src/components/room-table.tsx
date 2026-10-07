"use client";

import { useEffect, useRef, useState } from "react";
import { PokerTable } from "@/components/poker-table";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { MIN_TEAMS, TIER_LABEL, formatChips } from "@/lib/constants";
import type { PracticePool, SeatRequest } from "@/lib/controller";
import { PRACTICE_GROUPS, generateField } from "@/lib/field";
import { positionName, type Decision } from "@/lib/hand";
import type { Bot } from "@/lib/policy";
import { decryptHoles, encryptHoles, makeSeatKeys, type SeatKeys } from "@/lib/room-crypto";
import { openRoomBus, type RoomBus, type RoomEvent } from "@/lib/room-bus";
import { SEAT_STALE_MS, TableHost, hostStillAlive, hostView, seatChoices } from "@/lib/room-host";
import { Rng, hashString } from "@/lib/rng";
import { TableAudio } from "@/lib/table-audio";
import { cleanPlayerName, cleanRoomCode, makeRoomCode, streetLabel, turnText, visibleHole, type HoleView, type TableView } from "@/lib/table-view";

interface WireSeat {
  name: string;
  kind: "human" | "ai" | "open";
  playerId: string | null;
  detail: string;
  connected?: boolean;
}

interface WireLegal {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  canBet: boolean;
  canRaise: boolean;
  toCall: number;
  minBetTo: number;
  minRaiseTo: number;
  maxTo: number;
}

interface WireState {
  handNo: number;
  board: number[];
  pot: number;
  street: number;
  lastAction: string;
  button: number;
  actor: number;
  phase: "lobby" | "act" | "done";
  showdown: boolean;
  winners: number[];
  stacks: number[];
  nets: number[];
  folded: boolean[];
  allin: boolean[];
  seats: WireSeat[];
  hostPub: string;
  holes: (string | null)[];
  revealed: (number[] | null)[];
  legal: WireLegal | null;
}

export function RoomTable({
  role,
  initialCode = "",
  blinds,
  bots,
}: {
  role: "host" | "guest";
  initialCode?: string;
  blinds: boolean;
  bots: () => Bot[];
}) {
  const [name, setName] = useState(role === "host" ? "You" : "");
  const [savedName, setSavedName] = useState("");
  const [codeInput, setCodeInput] = useState(initialCode);
  const [code, setCode] = useState("");
  const [relay, setRelay] = useState<RoomBus["relay"] | "idle">("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [wire, setWire] = useState<WireState | null>(null);
  const [ownCards, setOwnCards] = useState<number[] | null>(null);
  const [sizing, setSizing] = useState<number[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [kicked, setKicked] = useState(false);
  const [hostGone, setHostGone] = useState(false);
  const [picking, setPicking] = useState<number | null>(null);
  const [pickQuery, setPickQuery] = useState("");
  const clientId = useRef(rememberPlayerId());
  const keys = useRef<SeatKeys | null>(null);
  const bus = useRef<RoomBus | null>(null);
  const host = useRef<TableHost | null>(null);
  const seq = useRef(0);
  const publishTail = useRef(Promise.resolve());
  const blindsRef = useRef(blinds);
  const botsRef = useRef(bots);
  const fallbackBots = useRef<Bot[] | null>(null);
  const seenSeq = useRef(0);
  const hostHeard = useRef(0);
  const hostClient = useRef<string | null>(null);
  const hostGoneRef = useRef(false);
  const audio = useRef<TableAudio | null>(null);
  blindsRef.current = blinds;
  botsRef.current = bots;
  function roster(): Bot[] {
    const field = botsRef.current();
    if (field.length >= 5) return field;
    if (!fallbackBots.current) fallbackBots.current = generateField("open-table", MIN_TEAMS, 60).bots;
    return fallbackBots.current;
  }
  if (!audio.current && typeof window !== "undefined") audio.current = new TableAudio();
  const refresh = () => setTick((value) => value + 1);

  useEffect(() => {
    if (role !== "guest") return;
    try {
      const stored = sessionStorage.getItem("kaiji-player-name") ?? "";
      setSavedName(stored);
      if (stored) setName((current) => current || stored);
    } catch {
      setSavedName("");
    }
  }, [role]);

  useEffect(() => {
    const table = audio.current ?? new TableAudio();
    audio.current = table;
    return () => {
      const mine = clientId.current;
      if (role === "host") bus.current?.publish({ id: `${mine}-close`, type: "close", clientId: mine, body: null });
      else bus.current?.publish({ id: `${mine}-drop`, type: "drop", clientId: mine, body: null });
      bus.current?.close();
      host.current = null;
      table.dispose();
      audio.current = null;
    };
  }, [role]);

  useEffect(() => {
    if (role !== "guest" || !code || kicked || hostGone) return;
    if (wire?.seats.some((seat) => seat.playerId === clientId.current && seat.connected !== false)) return;
    const timer = window.setInterval(() => {
      const publicKey = keys.current?.publicKey;
      if (!publicKey) return;
      bus.current?.publish({
        id: `${clientId.current.slice(0, 6)}-${Date.now().toString(36)}`,
        type: "join",
        clientId: clientId.current,
        body: { name: cleanPlayerName(name), publicKey, seat: null },
      });
    }, 1200);
    return () => window.clearInterval(timer);
  }, [role, code, wire, name, kicked, hostGone]);

  const local = host.current;
  const hand = local?.hand ?? null;
  const publishRef = useRef(publish);
  const aiFault = useRef("");
  publishRef.current = publish;

  useEffect(() => {
    if (!code || role !== "host") return;
    const timer = window.setInterval(() => {
      const table = host.current;
      const live = table?.hand;
      if (!table || !live) return;
      try {
        if (live.phase === "next-street") {
          table.advance();
          audio.current?.street();
          void publishRef.current();
          refresh();
        } else if (live.phase === "act" && table.occupants[live.actor]?.kicked) {
          if (table.stepKicked()) {
            audio.current?.fold();
            void publishRef.current();
            refresh();
          }
        } else if (live.phase === "act" && table.occupants[live.actor]?.kind === "ai") {
          if (table.aiStep()) {
            const acted = table.hand?.lastAction ?? "";
            if (acted.includes("fold")) audio.current?.fold();
            else if (acted.includes("check")) audio.current?.check();
            else if (acted.includes("shove")) audio.current?.allIn();
            else audio.current?.chips();
            void publishRef.current();
            refresh();
          }
        }
        if (table.sweep()) {
          setNotice("A player disconnected. Their chair is saved.");
          void publishRef.current();
          refresh();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "The AI could not act.";
        const key = `${table.handNo}:${live.actor}:${message}`;
        if (aiFault.current !== key) {
          aiFault.current = key;
          setNotice(message);
        }
      }
    }, 700);
    return () => window.clearInterval(timer);
  }, [code, role]);

  useEffect(() => {
    if (!code) return;
    const timer = window.setInterval(() => {
      if (role === "host") {
        bus.current?.publish({
          id: `${clientId.current.slice(0, 6)}-here-${Date.now().toString(36)}`,
          type: "here",
          clientId: clientId.current,
          body: null,
        });
        void publishRef.current();
        return;
      }
      if (hostGoneRef.current) return;
      bus.current?.publish({
        id: `${clientId.current.slice(0, 6)}-here-${Date.now().toString(36)}`,
        type: "here",
        clientId: clientId.current,
        body: null,
      });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [code, role]);

  function endBecauseHostLeft() {
    if (hostGoneRef.current) return;
    hostGoneRef.current = true;
    setHostGone(true);
    setError("The host disconnected. This game is over.");
    setWire(null);
    setOwnCards(null);
  }

  useEffect(() => {
    if (role !== "guest" || !code || hostGone) return;
    const timer = window.setInterval(() => {
      if (!hostStillAlive(hostHeard.current, Date.now(), SEAT_STALE_MS)) endBecauseHostLeft();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [code, role, hostGone]);

  function nextId(): string {
    return `${clientId.current.slice(0, 6)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  async function publish() {
    const table = host.current;
    const link = bus.current;
    const mine = keys.current;
    if (!table || !link || !mine) return;
    const n = ++seq.current;
    publishTail.current = publishTail.current.then(async () => {
      if (n !== seq.current || !host.current) return;
      const body = await wireFrom(host.current, mine);
      link.publish({ id: nextId(), type: "state", clientId: clientId.current, seq: n, body }, true);
    }).catch(() => undefined);
    await publishTail.current;
  }

  function onEvent(event: RoomEvent) {
    if (event.clientId === clientId.current && event.type !== "join") return;
    if (role === "host") {
      const table = host.current;
      if (!table) return;
      if (event.type === "join") {
        const body = event.body as { name?: string; publicKey?: string; seat?: number | null };
        if (!body?.publicKey) return;
        const result = table.claim(event.clientId, body.name ?? "Player", body.publicKey, body.seat ?? null);
        if ("error" in result) {
          setNotice(result.error);
          bus.current?.publish({
            id: nextId(),
            type: "refuse",
            clientId: clientId.current,
            body: { playerId: event.clientId, error: result.error },
          });
        } else setNotice(`${cleanPlayerName(body.name ?? "Player")} ${result.rejoined ? "sat back down" : "sat down"}.`);
        void publish();
        refresh();
      } else if (event.type === "drop") {
        const dropped = table.markDropped(event.clientId);
        if (dropped) setNotice(`${dropped} disconnected. Their chair is saved.`);
        void publish();
        refresh();
      } else if (event.type === "here") {
        const back = table.noteHere(event.clientId);
        if (back) {
          setNotice(`${back} sat back down.`);
          void publish();
          refresh();
        }
      } else if (event.type === "leave") {
        table.leave(event.clientId);
        void publish();
        refresh();
      } else if (event.type === "act") {
        const body = event.body as Decision;
        const problem = table.act(event.clientId, body);
        if (problem) setNotice(problem);
        else audio.current?.chips();
        void publish();
        refresh();
      }
      return;
    }
    if (event.type === "state") {
      hostClient.current = event.clientId;
      hostHeard.current = Date.now();
    } else if (hostClient.current && event.clientId === hostClient.current && event.type !== "close") {
      hostHeard.current = Date.now();
    }
    if (event.type === "kick") {
      const body = event.body as { playerId?: string; pending?: boolean };
      if (body?.playerId === clientId.current) {
        setKicked(true);
        setError(body.pending ? "The host kicked you. You leave when this hand ends." : "The host kicked you.");
      }
      return;
    }
    if (event.type === "refuse") {
      const body = event.body as { playerId?: string; error?: string };
      if (body?.playerId === clientId.current && body.error) {
        setError(body.error);
        if (body.error === "The host kicked you.") setKicked(true);
      }
      return;
    }
    if (event.type === "close") {
      endBecauseHostLeft();
      return;
    }
    if (event.type !== "state") return;
    const body = event.body as WireState;
    if (!body || typeof body.handNo !== "number") return;
    void applyGuestState(body, event.seq ?? 0);
  }

  async function applyGuestState(body: WireState, order: number) {
    if (hostGoneRef.current) return;
    if (order < seenSeq.current) return;
    seenSeq.current = order;
    const mine = keys.current;
    const seat = body.seats.findIndex((item) => item.playerId === clientId.current);
    let cards: number[] | null = null;
    if (mine && body.hostPub && seat >= 0 && body.holes[seat]) {
      cards = await decryptHoles(mine.privateKey, body.hostPub, body.holes[seat]);
    }
    setOwnCards(cards);
    setWire(body);
    if (body.actor === seat && body.phase === "act") audio.current?.yourTurn();
  }

  async function connect(nextCode: string, nextName: string) {
    setError(null);
    setNotice(null);
    const roomCode = cleanRoomCode(nextCode);
    if (role === "guest" && roomCode.length < 5) {
      setError("Enter the five-character table code.");
      return;
    }
    const issued = role === "host" ? makeRoomCode() : roomCode;
    keys.current = await makeSeatKeys();
    if (role === "host") {
      const table = new TableHost(clientId.current, nextName, blindsRef.current, new Rng(hashString(issued + clientId.current)));
      table.setHostKey(keys.current.publicKey);
      host.current = table;
    }
    bus.current?.close();
    bus.current = openRoomBus(issued, onEvent, setRelay);
    setCode(issued);
    try {
      sessionStorage.setItem("kaiji-room-code", issued);
      sessionStorage.setItem("kaiji-player-name", cleanPlayerName(nextName));
    } catch {
      /* private mode can refuse storage; the chair still works for this page */
    }
    audio.current?.unlock();
    if (role === "guest") {
      window.setTimeout(() => {
        bus.current?.publish({
          id: nextId(),
          type: "join",
          clientId: clientId.current,
          body: { name: cleanPlayerName(nextName), publicKey: keys.current?.publicKey, seat: null },
        });
      }, 300);
    } else {
      void publish();
    }
    refresh();
  }

  function sendAct(decision: Decision) {
    if (role === "host") {
      const table = host.current;
      if (!table) {
        setError("The table is not open.");
        return;
      }
      const problem = table.act(clientId.current, decision);
      if (problem) setError(problem);
      else {
        setError(null);
        setSizing(null);
        if (decision.act === "fold") audio.current?.fold();
        else if (decision.act === "check") audio.current?.check();
        else if (decision.act === "allin") audio.current?.allIn();
        else audio.current?.chips();
        void publish();
        refresh();
      }
      return;
    }
    bus.current?.publish({
      id: nextId(),
      type: "act",
      clientId: clientId.current,
      body: decision,
    });
    setSizing(null);
  }

  function deal() {
    const table = host.current;
    if (!table) {
      setError("The table is not open.");
      return;
    }
    table.setBlinds(blindsRef.current);
    const problem = table.deal(roster());
    if (problem) setError(problem);
    else {
      setError(null);
      audio.current?.deal();
      void publish();
      refresh();
    }
  }

  function sit(seat: number) {
    if (role === "host") {
      host.current?.vacate(seat);
      setPicking(null);
      void publish();
      refresh();
      return;
    }
    bus.current?.publish({
      id: nextId(),
      type: "join",
      clientId: clientId.current,
      body: { name: cleanPlayerName(name), publicKey: keys.current?.publicKey, seat },
    });
  }

  function kickSeat(seat: number) {
    const table = host.current;
    if (!table) return;
    const result = table.kick(seat);
    if ("error" in result) {
      setNotice(result.error);
      return;
    }
    setNotice(result.pending ? `${result.name} leaves when this hand ends.` : `${result.name} was kicked.`);
    bus.current?.publish({
      id: nextId(),
      type: "kick",
      clientId: clientId.current,
      body: { playerId: result.playerId, pending: result.pending },
    });
    void publish();
    refresh();
  }

  function fillSeat(seat: number, request: SeatRequest) {
    const table = host.current;
    if (!table) return;
    const problem = table.seatAi(seat, roster(), request);
    if (problem) setNotice(problem);
    else {
      setNotice(`${table.occupants[seat]?.name ?? "An AI"} sat down.`);
      setPicking(null);
      setPickQuery("");
      void publish();
      refresh();
    }
  }

  const guestView = wire ? guestTable(wire, clientId.current, ownCards) : null;
  const view = local ? hostView(local) : guestView;
  const yourTurn = Boolean(view && view.phase === "act" && view.actor === view.yourSeat && view.seats[view.yourSeat]?.isYou);
  const legal = yourTurn ? (local && hand ? hand.legal(hand.actor) : wire?.legal) : null;
  const link = code && typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}#table-${code}` : "";

  return (
    <div className="flex flex-col gap-3" data-testid="room-table" data-rev={tick}>
      {!code ? (
        <div className="rounded-xl border bg-card p-3">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{role === "host" ? "Host" : "Join"}</p>
          <label className="mt-2 block text-sm" htmlFor="room-name">
            Your name
            <input
              id="room-name"
              value={name}
              maxLength={18}
              className="mt-1 min-h-11 w-full rounded-lg border border-input bg-[#221812] px-2.5 text-base text-[#f3e6d0] outline-none"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {role === "guest" ? (
            <label className="mt-2 block text-sm" htmlFor="room-code-input">
              Table code
              <input
                id="room-code-input"
                value={codeInput}
                maxLength={5}
                autoCapitalize="characters"
                className="mt-1 min-h-11 w-full rounded-lg border border-input bg-[#221812] px-2.5 text-base uppercase tracking-[0.3em] text-[#f3e6d0] outline-none"
                onChange={(event) => setCodeInput(cleanRoomCode(event.target.value))}
              />
            </label>
          ) : null}
          {error ? <p className="mt-2 text-sm text-[#ffb4b4]">{error}</p> : null}
          <Button className="mt-3 min-h-12 w-full" onClick={() => void connect(role === "host" ? "" : codeInput, savedName && !name.trim() ? savedName : name)}>
            {role === "host" ? "Open the table" : savedName && cleanPlayerName(name || savedName) === savedName ? "Sit back down" : "Sit down"}
          </Button>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Share the code with the people at the table. Open chairs stay open so a friend can sit. The host can kick a player, seat a random AI, or tap a named player. Empty chairs still fill at random when the host deals. The host deals the cards. Hole cards are encrypted to each seat. This table does not move the ladder.
            {role === "guest"
              ? " If you disconnect, your chair stays. Sit back down with the same name, even in the middle of a hand. If the host leaves, the game ends."
              : " A friend who disconnects keeps their chair until they sit back down with the same name."}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border bg-card p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              {relay === "relay" ? "Friends can join from another phone" : relay === "local" ? "Open on this device only" : "Connecting the room"}
            </p>
            <p className="font-display text-sm tracking-[0.28em] text-[#e2b657]" data-room-code>
              {code}
            </p>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              className="min-h-11"
              variant="outline"
              onClick={() => {
                void navigator.clipboard?.writeText(link).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1200);
                });
              }}
            >
              {copied ? "Copied" : "Copy join link"}
            </Button>
          </div>
          {notice ? <p className="mt-2 text-sm">{notice}</p> : null}
          {error ? <p className="mt-2 text-sm text-[#ffb4b4]">{error}</p> : null}
        </div>
      )}
      {hostGone ? (
        <div data-testid="host-gone" className="rounded-xl border border-[#6b3030] bg-[#2a1212] p-4">
          <p className="text-lg leading-snug text-[#ffe8e0]">The host disconnected. This game is over.</p>
        </div>
      ) : view ? (
        <>
          {role === "host" ? (
            <HostChairs
              seats={view.seats}
              between={!hand || hand.phase === "done"}
              picking={picking}
              query={pickQuery}
              bots={roster()}
              taken={new Set(local?.occupants.flatMap((seat) => (seat.botId ? [seat.botId] : [])) ?? [])}
              onPickSeat={(seat) => {
                setPicking(seat);
                setPickQuery("");
              }}
              onQuery={setPickQuery}
              onRandom={(seat) => fillSeat(seat, { pool: "random", botId: null })}
              onChoose={(seat, request) => fillSeat(seat, request)}
              onKick={kickSeat}
              onRemove={sit}
            />
          ) : null}
          <PokerTable
            view={view}
            onSit={
              code && role === "guest"
                ? sit
                : code && role === "host" && (!hand || hand.phase === "done")
                  ? (seat) => {
                      setPicking(seat);
                      setPickQuery("");
                    }
                  : undefined
            }
            onVacate={code && role === "host" && (!hand || hand.phase === "done") ? sit : undefined}
          />
          <div className="sticky bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-20 rounded-xl border border-black/50 bg-[#08281e]/95 p-2 backdrop-blur">
            {role === "host" && (!hand || hand.phase === "done") ? (
              <Button className="min-h-12 w-full text-base" onClick={deal}>
                {hand ? "Next hand" : "Deal the hand"}
              </Button>
            ) : null}
            {yourTurn && legal ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                {legal.canFold ? (
                  <Button className="min-h-12 text-base" variant="outline" onClick={() => sendAct({ act: "fold" })}>
                    Fold
                  </Button>
                ) : null}
                {legal.canCheck ? (
                  <Button className="min-h-12 text-base" variant="outline" onClick={() => sendAct({ act: "check" })}>
                    Check
                  </Button>
                ) : null}
                {legal.canCall ? (
                  <Button className="min-h-12 text-base" onClick={() => sendAct({ act: "call" })}>
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
                <Button className="col-span-2 min-h-12 text-base" onClick={() => sendAct({ act: "allin" })}>
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
                <Button className="mt-3 min-h-12 w-full" onClick={() => sendAct(legal.canBet ? { act: "bet", to: sizing[0] } : { act: "raise", to: sizing[0] })}>
                  Confirm
                </Button>
              </div>
            ) : null}
            {view.phase === "act" && !yourTurn ? (
              <p className="text-center text-sm text-[#d5c7ae]">{turnText(view)}</p>
            ) : null}
            {role === "guest" && view.phase === "show" ? (
              <p className="text-center text-sm text-[#d5c7ae]">Waiting for the host to deal the next hand.</p>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Session {view.seats.map((seat, index) => (seat.empty ? null : `${seat.name} ${formatChips((local?.nets ?? wire?.nets ?? [])[index] ?? 0)}`)).filter(Boolean).join(" · ")}
          </p>
        </>
      ) : null}
    </div>
  );
}

async function wireFrom(table: TableHost, mine: SeatKeys): Promise<WireState> {
  const hand = table.hand;
  const rawHoles = hand ? hand.hole.map((cards) => cards.slice()) : null;
  const foldedNow = hand ? hand.folded.slice() : [false, false, false, false, false, false];
  const showdown = Boolean(hand?.showdown);
  const actor = hand && hand.phase === "act" ? hand.actor : -1;
  const legal = actor >= 0 && hand ? { ...hand.legal(actor) } : null;
  const publicState = {
    handNo: table.handNo,
    board: hand?.board.slice() ?? [],
    pot: hand?.pot ?? 0,
    street: hand?.street ?? 0,
    lastAction: hand?.lastAction ?? "",
    button: table.button,
    actor,
    phase: (!hand ? "lobby" : hand.phase === "done" ? "done" : "act") as WireState["phase"],
    showdown,
    winners: hand?.winners.slice() ?? [],
    stacks: hand ? hand.stack.slice() : table.occupants.map((seat) => (seat.kind === "open" ? 0 : 10000)),
    nets: table.nets.slice(),
    folded: foldedNow,
    allin: hand ? hand.allin.slice() : [false, false, false, false, false, false],
    seats: table.occupants.map((seat) => ({
      name: seat.name,
      kind: seat.kind,
      playerId: seat.playerId,
      detail: seat.detail,
      connected: seat.connected,
    })),
  };
  const holes: (string | null)[] = [null, null, null, null, null, null];
  const revealed: (number[] | null)[] = [null, null, null, null, null, null];
  if (rawHoles) {
    for (let i = 0; i < 6; i++) {
      const seat = publicState.seats[i];
      const key = table.occupants[i]?.publicKey;
      if (showdown && !foldedNow[i]) revealed[i] = rawHoles[i];
      else if (key && seat) holes[i] = await encryptHoles(mine.privateKey, key, rawHoles[i]);
    }
  }
  return { ...publicState, hostPub: mine.publicKey, holes, revealed, legal };
}

function HostChairs({
  seats,
  between,
  picking,
  query,
  bots,
  taken,
  onPickSeat,
  onQuery,
  onRandom,
  onChoose,
  onKick,
  onRemove,
}: {
  seats: TableView["seats"];
  between: boolean;
  picking: number | null;
  query: string;
  bots: Bot[];
  taken: Set<string>;
  onPickSeat: (seat: number) => void;
  onQuery: (query: string) => void;
  onRandom: (seat: number) => void;
  onChoose: (seat: number, request: SeatRequest) => void;
  onKick: (seat: number) => void;
  onRemove: (seat: number) => void;
}) {
  const hits = seatChoices(bots, taken, query);
  return (
    <div className="rounded-xl border bg-card p-3" data-testid="host-seats">
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Chairs</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        An open chair can take a friend with the code, a random AI, or a named player you tap. Kick removes a player. Kaiji can sit once.
      </p>
      <ul className="mt-2 flex flex-col gap-2">
        {seats.map((seat, index) => {
          if (index === 0) return null;
          return (
            <li key={index} className="rounded-lg border border-border/80 p-2" data-chair={index}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 truncate text-sm">
                  <span className="text-muted-foreground">Chair {index} · </span>
                  {seat.empty ? "Open" : seat.name}
                  {seat.away ? " · Disconnected" : ""}
                </p>
                <div className="flex flex-wrap gap-2">
                  {seat.empty && between ? (
                    <>
                      <Button type="button" className="min-h-11" variant="outline" onClick={() => onRandom(index)}>
                        Random AI
                      </Button>
                      <Button type="button" className="min-h-11" variant={picking === index ? "default" : "outline"} onClick={() => onPickSeat(picking === index ? -1 : index)}>
                        {picking === index ? "Close" : "Choose AI"}
                      </Button>
                    </>
                  ) : null}
                  {seat.human && !seat.isYou ? (
                    <Button type="button" className="min-h-11" variant="outline" onClick={() => onKick(index)}>
                      Kick
                    </Button>
                  ) : null}
                  {!seat.empty && !seat.human && between ? (
                    <Button type="button" className="min-h-11" variant="outline" onClick={() => onRemove(index)}>
                      Remove
                    </Button>
                  ) : null}
                </div>
              </div>
              {picking === index && seat.empty && between ? (
                <AiMenu
                  hits={hits}
                  query={query}
                  onQuery={onQuery}
                  onPool={(pool) => onChoose(index, { pool, botId: null })}
                  onName={(botId) => onChoose(index, { pool: "random", botId })}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function AiMenu({
  hits,
  query,
  onQuery,
  onPool,
  onName,
}: {
  hits: Bot[];
  query: string;
  onQuery: (query: string) => void;
  onPool: (pool: PracticePool) => void;
  onName: (botId: string) => void;
}) {
  return (
    <div className="mt-2" data-testid="ai-picker">
      <input
        value={query}
        placeholder="Type a name or a style"
        aria-label="AI name"
        className="min-h-11 w-full rounded-lg border border-input bg-[#221812] px-2.5 text-base text-[#f3e6d0] outline-none placeholder:text-[#c4b39a]"
        onChange={(event) => onQuery(event.target.value)}
      />
      {hits.length > 0 ? (
        <div role="listbox" aria-label="Named players" className="mt-1 max-h-52 overflow-auto rounded-lg border border-[#4a382c] bg-[#221812]">
          {hits.map((hit) => (
            <button
              key={hit.id}
              type="button"
              role="option"
              aria-selected={false}
              data-seat-ai={hit.name}
              className="flex min-h-11 w-full items-center justify-between gap-2 px-2 text-left text-sm text-[#f3e6d0]"
              onClick={() => onName(hit.id)}
            >
              <span className="truncate">{hit.name}</span>
              <span className="shrink-0 text-[#c4b39a]">{hit.playsKaiji ? "Kaiji chart" : hit.params.personality}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-1 text-xs text-[#c4b39a]">No player matches.</p>
      )}
      <div role="listbox" aria-label="Styles" className="mt-2 max-h-40 overflow-auto rounded-lg border border-[#4a382c] bg-[#221812] p-1">
        <PoolChoice label="Random player" onPick={() => onPool("random")} />
        <PoolChoice label="Kaiji" onPick={() => onPool("kaiji")} />
        <PoolChoice label="Kaiji chart copies" onPick={() => onPool("kaiji-chart")} />
        {PRACTICE_GROUPS.map((group) => (
          <div key={group.tier}>
            <p className="px-2 pt-2 text-[10px] uppercase tracking-[0.16em] text-[#c4b39a]">{TIER_LABEL[group.tier]}</p>
            <PoolChoice label={`Any ${TIER_LABEL[group.tier]}`} onPick={() => onPool(group.tier)} />
            {group.personalities.map((name) => (
              <PoolChoice key={name} label={name} onPick={() => onPool(`style:${name}`)} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function PoolChoice({ label, onPick }: { label: string; onPick: () => void }) {
  return (
    <button type="button" role="option" aria-selected={false} className="flex min-h-11 w-full items-center rounded-md px-2 text-left text-base text-[#f3e6d0]" onClick={onPick}>
      {label}
    </button>
  );
}

function rememberPlayerId(): string {
  const key = "kaiji-player-id";
  if (typeof window === "undefined") return "pending";
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const created = `p${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
    sessionStorage.setItem(key, created);
    return created;
  } catch {
    return `p${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
  }
}

function guestTable(wire: WireState, myId: string, ownCards: number[] | null): TableView {
  const found = wire.seats.findIndex((seat) => seat.playerId === myId);
  const yourSeat = found >= 0 ? found : 0;
  const phase = wire.phase === "done" ? "show" : wire.phase === "lobby" ? "lobby" : "act";
  return {
    phase,
    yourSeat,
    button: wire.button,
    actor: wire.actor,
    pot: wire.pot,
    board: wire.board,
    streetLabel: streetLabel(wire.street, phase),
    lastAction: wire.lastAction,
    seats: wire.seats.map((seat, index) => {
      const hole = seat.playerId === myId ? ownCards : wire.revealed[index];
      const away = seat.kind === "human" && seat.connected === false;
      const cards: HoleView = seat.kind === "open" ? "back" : visibleHole(hole, seat.playerId === myId && !!ownCards, wire.showdown, wire.folded[index]);
      const detail = away ? "Disconnected" : seat.detail;
      return {
        name: seat.name,
        stack: wire.stacks[index] ?? 0,
        folded: wire.folded[index] ?? false,
        allin: wire.allin[index] ?? false,
        empty: seat.kind === "open",
        human: seat.kind === "human",
        isYou: seat.playerId === myId,
        away,
        cards,
        detail: wire.phase === "lobby" ? detail : `${positionName((index - wire.button + 6) % 6, 6)} · ${detail}`,
      };
    }),
  };
}
