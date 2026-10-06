"use client";

import { useEffect, useRef, useState } from "react";
import { PlayingCard } from "@/components/cards";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { TIER_LABEL, asset, formatChips } from "@/lib/constants";
import { PRACTICE_GROUPS } from "@/lib/field";
import { HandMachine, type Act, type Decision } from "@/lib/hand";
import { kaijiDecision } from "@/lib/kaiji";
import { decideBot } from "@/lib/policy";
import type { PracticePool, PracticeSeat } from "@/lib/controller";
import { Rng, hashString } from "@/lib/rng";
import { TableAudio, handResult } from "@/lib/table-audio";

const STREETS = ["Preflop", "Flop", "Turn", "River"];

export function HeadsUp({
  blinds,
  pickOpponent,
}: {
  blinds: boolean;
  pickOpponent: (pool: PracticePool) => PracticeSeat | null;
}) {
  const rng = useRef(new Rng(hashString("kaiji-heads-up")));
  const handRef = useRef<HandMachine | null>(null);
  const accounted = useRef(false);
  const [tick, setTick] = useState(0);
  const [nets, setNets] = useState<[number, number]>([0, 0]);
  const [dealt, setDealt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sizing, setSizing] = useState<number[] | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const audio = useRef<TableAudio | null>(null);
  const heardTurn = useRef(false);
  const rootRef = useRef<HTMLElement | null>(null);
  const opponentRef = useRef<PracticeSeat | null>(null);
  const [pool, setPool] = useState<PracticePool>("kaiji");
  const [opponent, setOpponent] = useState<PracticeSeat | null>(null);
  if (!audio.current && typeof window !== "undefined") audio.current = new TableAudio();
  const refresh = () => setTick((value) => value + 1);

  useEffect(() => {
    const table = audio.current ?? new TableAudio();
    audio.current = table;
    setSoundOn(!table.muted);
    const node = rootRef.current;
    const observer = node
      ? new IntersectionObserver(([entry]) => table.setAudible(entry.isIntersecting), { threshold: 0.15 })
      : null;
    if (node && observer) observer.observe(node);
    return () => {
      observer?.disconnect();
      table.dispose();
      audio.current = null;
    };
  }, []);

  const hand = handRef.current;

  useEffect(() => {
    const current = handRef.current;
    if (!current || current.phase !== "next-street") return;
    const timer = window.setTimeout(() => {
      try {
        current.advance();
        audio.current?.street();
        settle(current);
        refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The deal failed.");
      }
    }, 520);
    return () => window.clearTimeout(timer);
  }, [tick]);

  useEffect(() => {
    const current = handRef.current;
    if (!current || current.phase !== "act" || current.actor !== 1) return;
    const timer = window.setTimeout(() => {
      try {
        const ctx = current.fillCtx(1);
        const decision = opponentDecision(ctx);
        current.act(1, decision);
        voice(decision.act, current);
        settle(current);
        refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The opponent could not act.");
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [tick]);

  function settle(current: HandMachine | null) {
    if (!current || current.phase !== "done" || accounted.current) return;
    accounted.current = true;
    setNets((currentNets) => [
      currentNets[0] + current.stack[0] - 10000,
      currentNets[1] + current.stack[1] - 10000,
    ]);
    setDealt((count) => count + 1);
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

  function opponentDecision(ctx: ReturnType<HandMachine["fillCtx"]>): Decision {
    const seat = opponentRef.current;
    if (!seat || seat.usesKaiji || !seat.bot) return kaijiDecision(ctx.hole0, ctx.hole1, ctx.board, ctx.street, ctx.toCall);
    ctx.ownElo = seat.bot.elo;
    ctx.oppAvgElo = 1500;
    return decideBot(seat.bot, ctx, () => rng.current.next());
  }

  function drawOpponent(): boolean {
    const seat = pickOpponent(pool);
    if (!seat) {
      setError("Nobody in that group is seated in this field.");
      return false;
    }
    opponentRef.current = seat;
    setOpponent(seat);
    setNets([0, 0]);
    setDealt(0);
    return true;
  }

  function deal(rematch = false) {
    if (!opponentRef.current || rematch) {
      if (!drawOpponent()) return;
    }
    setError(null);
    setSizing(null);
    accounted.current = false;
    heardTurn.current = false;
    audio.current?.unlock();
    audio.current?.startMusic();
    audio.current?.deal();
    handRef.current = new HandMachine({
      n: 2,
      button: dealt % 2,
      blinds,
      rng: rng.current,
      keepLog: true,
    });
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

  const yourTurn = Boolean(hand && hand.phase === "act" && hand.actor === 0);
  useEffect(() => {
    if (yourTurn && !heardTurn.current) audio.current?.yourTurn();
    heardTurn.current = yourTurn;
  }, [yourTurn, tick]);
  const legal = yourTurn && hand ? hand.legal(0) : null;
  const revealKaiji = Boolean(hand && hand.showdown);
  const street = hand ? STREETS[hand.street] ?? "Showdown" : "Waiting";

  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    audio.current?.setMuted(!next);
    if (next && handRef.current) audio.current?.startMusic();
  }

  return (
    <section ref={rootRef} className="flex flex-col gap-4">
      <MatchPicker pool={pool} setPool={setPool} opponent={opponent} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="felt relative rounded-[2rem] p-4 sm:p-6">
        <p className="pointer-events-none absolute inset-x-0 top-6 text-center font-display text-xs tracking-[0.4em] text-[#e2b657]/30">
          ざわ…ざわ…
        </p>
        {!hand ? (
          <div className="flex min-h-72 flex-col items-center justify-center gap-4 text-center">
            {opponent?.usesKaiji ? (
              <img src={asset("/kaiji.png")} alt="" className="pixel-art size-20 border-2 border-black shadow-[4px_4px_0_#000]" />
            ) : (
              <span className="grid size-20 place-items-center border-2 border-black bg-[#2a211b] font-display text-xs text-[#f6efe2]">
                {(opponent?.name ?? "AI").slice(0, 2)}
              </span>
            )}
            <div>
              <h2 className="font-display text-sm text-[#f6efe2]">
                {opponent ? `${opponent.name} is in the chair` : "Pick who sits across from you"}
              </h2>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[#d5c7ae]">
                Heads-up is practice. It does not move the ladder. You each get 10,000 chips a hand.
                {blinds ? " Blinds are 50 and 100, and the button posts the small blind." : " Blinds are off. An all-check hand moves nothing."}
              </p>
            </div>
            {error ? <p className="max-w-sm text-sm text-[#ffb4b4]">{error}</p> : null}
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button className="min-h-12" size="lg" onClick={() => deal()}>
                Deal the hand
              </Button>
              <SoundButton on={soundOn} onToggle={toggleSound} />
            </div>
          </div>
        ) : (
          <div className="mx-auto flex min-h-72 max-w-xl flex-col items-center gap-4 pt-8">
            <div className={`w-full rounded-xl border px-3 py-2 ${hand.actor === 1 && hand.phase === "act" ? "border-[#e2b657]" : "border-black/40"} bg-black/30`}>
              <div className="flex items-center gap-2">
                {opponent?.usesKaiji ? (
                  <img src={asset("/kaiji.png")} alt="" className="pixel-art size-10 border border-black" />
                ) : (
                  <span className="grid size-10 place-items-center border border-black bg-[#2a211b] text-[10px] text-[#f6efe2]">
                    {(opponent?.name ?? "AI").slice(0, 2)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-[10px] text-[#f6efe2]">{opponent?.name ?? "Opponent"}</p>
                  <p className="truncate text-xs text-[#d5c7ae]">
                    {opponent ? `${opponent.style} · ${opponent.personality}` : ""}
                    {hand.actor === 1 && hand.phase === "act" ? " · Thinking…" : hand.lastAction ? ` · ${hand.lastAction}` : ""}
                  </p>
                </div>
                <p className="text-sm text-[#f6efe2]">{hand.stack[1].toLocaleString("en-US")}</p>
              </div>
              <div className="mt-2 flex justify-center gap-1">
                {revealKaiji ? (
                  hand.hole[1].map((card) => <PlayingCard key={card} card={card} />)
                ) : (
                  <>
                    <PlayingCard card={null} />
                    <PlayingCard card={null} />
                  </>
                )}
              </div>
            </div>

            <div className="text-center">
              <p className="text-xs uppercase tracking-[0.2em] text-[#e2b657]">{hand.phase === "done" ? "Hand over" : street}</p>
              <p className="mt-1 text-sm text-[#f6efe2]">Pot {hand.pot.toLocaleString("en-US")}</p>
              <div className="mt-2 flex min-h-16 justify-center gap-1">
                {hand.board.length === 0 ? <p className="self-center text-xs text-[#d5c7ae]">No board yet</p> : null}
                {hand.board.map((card) => (
                  <PlayingCard key={card} card={card} />
                ))}
              </div>
              {hand.phase === "done" ? (
                <p className="mt-2 text-sm text-[#f6efe2]">{hand.lastAction}</p>
              ) : null}
            </div>

            <div className={`w-full rounded-xl border px-3 py-2 ${yourTurn ? "border-[#e24b4b]" : "border-black/40"} bg-black/35`}>
              <div className="mb-2 flex items-center justify-between text-sm text-[#f6efe2]">
                <span>You {yourTurn ? "· your action" : ""}</span>
                <span>{hand.stack[0].toLocaleString("en-US")}</span>
              </div>
              <div className="flex justify-center gap-1">
                {hand.hole[0].map((card) => (
                  <PlayingCard key={card} card={card} />
                ))}
              </div>
            </div>
            <div className="sticky bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-20 w-full rounded-xl border border-black/50 bg-[#08281e]/95 p-2 backdrop-blur">
              {error ? <p className="mb-2 text-sm text-[#ffb4b4]">{error}</p> : null}
              {hand.phase === "done" ? (
                <div className="grid grid-cols-2 gap-2">
                  <Button className="min-h-12 text-base" variant="outline" onClick={() => deal(true)}>
                    New opponent
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
                    <Button className="min-h-12 text-base" onClick={() => act({ act: "call" })}>Call {legal.toCall.toLocaleString("en-US")}</Button>
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
              {!yourTurn && hand.phase !== "done" ? (
                <p className="text-center text-sm text-[#d5c7ae]">
                  {hand.phase === "act" ? `${opponent?.name ?? "The opponent"} has the action.` : "The next card is coming."}
                </p>
              ) : null}
            </div>
          </div>
        )}
      </div>

      <aside className="flex flex-col gap-3">
        <div className="rounded-xl border bg-card p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Session chips</p>
            <SoundButton on={soundOn} onToggle={toggleSound} />
          </div>
          <p className="mt-1 text-sm">You {formatChips(nets[0])}</p>
          <p className="text-sm">{opponent?.name ?? "Opponent"} {formatChips(nets[1])}</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {dealt} hand{dealt === 1 ? "" : "s"} with this opponent. A new opponent starts the chip count over. This table does not move the ladder.
          </p>
        </div>
      </aside>
      </div>
    </section>
  );
}

function MatchPicker({
  pool,
  setPool,
  opponent,
}: {
  pool: PracticePool;
  setPool: (pool: PracticePool) => void;
  opponent: PracticeSeat | null;
}) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <label htmlFor="match-pool" className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
        Match
      </label>
      <select
        id="match-pool"
        className="mt-2 min-h-11 w-full rounded-lg border border-input bg-transparent px-2.5 text-base"
        value={pool}
        onChange={(event) => setPool(event.target.value as PracticePool)}
      >
        <option value="random">Random match</option>
        <option value="kaiji">Kaiji</option>
        <option value="kaiji-chart">Kaiji chart copies</option>
        {PRACTICE_GROUPS.map((group) => (
          <optgroup key={group.tier} label={TIER_LABEL[group.tier]}>
            <option value={group.tier}>Any {TIER_LABEL[group.tier]}</option>
            {group.personalities.length > 1
              ? group.personalities.map((name) => (
                  <option key={name} value={`style:${name}`}>
                    {name}
                  </option>
                ))
              : null}
          </optgroup>
        ))}
      </select>
      <p className="mt-2 text-sm">
        {opponent ? (
          <>
            Seated: {opponent.name} <span className="text-muted-foreground">· {opponent.style} · {opponent.personality}</span>
          </>
        ) : (
          <span className="text-muted-foreground">No one is seated yet.</span>
        )}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Random draws anyone in the field. A style or a personality draws one player of that type. Next hand stays with them. New opponent draws again.
      </p>
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
