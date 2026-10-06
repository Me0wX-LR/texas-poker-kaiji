"use client";

import { useEffect, useRef, useState } from "react";
import { PlayingCard } from "@/components/cards";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { asset, formatChips } from "@/lib/constants";
import { HandMachine, type Decision } from "@/lib/hand";
import { kaijiDecision } from "@/lib/kaiji";
import { Rng, hashString } from "@/lib/rng";

const STREETS = ["Preflop", "Flop", "Turn", "River"];

export function HeadsUp({ blinds }: { blinds: boolean }) {
  const rng = useRef(new Rng(hashString("kaiji-heads-up")));
  const handRef = useRef<HandMachine | null>(null);
  const accounted = useRef(false);
  const [tick, setTick] = useState(0);
  const [nets, setNets] = useState<[number, number]>([0, 0]);
  const [dealt, setDealt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sizing, setSizing] = useState<number[] | null>(null);
  const refresh = () => setTick((value) => value + 1);

  const hand = handRef.current;

  useEffect(() => {
    const current = handRef.current;
    if (!current || current.phase !== "next-street") return;
    const timer = window.setTimeout(() => {
      try {
        current.advance();
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
        current.act(1, kaijiDecision(ctx.hole0, ctx.hole1, ctx.board, ctx.street, ctx.toCall));
        settle(current);
        refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Kaiji could not act.");
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
  }

  function deal() {
    setError(null);
    setSizing(null);
    accounted.current = false;
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
      setSizing(null);
      settle(current);
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That action was refused.");
    }
  }

  const yourTurn = Boolean(hand && hand.phase === "act" && hand.actor === 0);
  const legal = yourTurn && hand ? hand.legal(0) : null;
  const revealKaiji = Boolean(hand && hand.showdown);
  const street = hand ? STREETS[hand.street] ?? "Showdown" : "Waiting";

  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="felt relative rounded-[2rem] p-4 sm:p-6">
        <p className="pointer-events-none absolute inset-x-0 top-6 text-center font-display text-xs tracking-[0.4em] text-[#e2b657]/30">
          ざわ…ざわ…
        </p>
        {!hand ? (
          <div className="flex min-h-72 flex-col items-center justify-center gap-4 text-center">
            <img src={asset("/kaiji.png")} alt="Kaiji" className="pixel-art size-20 border-2 border-black shadow-[4px_4px_0_#000]" />
            <div>
              <h2 className="font-display text-sm text-[#f6efe2]">Kaiji is already in the chair</h2>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[#d5c7ae]">
                Heads-up is practice. It does not move the ladder. You each get 10,000 chips a hand.
                {blinds ? " Blinds are 50 and 100, and the button posts the small blind." : " Blinds are off. An all-check hand moves nothing."}
              </p>
            </div>
            <Button size="lg" onClick={deal}>
              Deal the hand
            </Button>
          </div>
        ) : (
          <div className="mx-auto flex min-h-72 max-w-xl flex-col items-center gap-4 pt-8">
            <div className={`w-full rounded-xl border px-3 py-2 ${hand.actor === 1 && hand.phase === "act" ? "border-[#e2b657]" : "border-black/40"} bg-black/30`}>
              <div className="flex items-center gap-2">
                <img src={asset("/kaiji.png")} alt="" className="pixel-art size-10 border border-black" />
                <div className="min-w-0 flex-1">
                  <p className="font-display text-[10px] text-[#f6efe2]">Kaiji</p>
                  <p className="truncate text-xs text-[#d5c7ae]">{hand.actor === 1 && hand.phase === "act" ? "Thinking…" : hand.lastAction || "Waiting"}</p>
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
            <div className="sticky bottom-2 z-20 w-full rounded-xl border border-black/50 bg-[#08281e]/95 p-2 backdrop-blur">
              {error ? <p className="mb-2 text-sm text-[#ffb4b4]">{error}</p> : null}
              {hand.phase === "done" ? (
                <Button className="w-full" onClick={deal}>
                  Next hand
                </Button>
              ) : null}
              {yourTurn && legal ? (
                <div className="grid grid-cols-2 gap-2">
                  {legal.canFold ? (
                    <Button variant="outline" onClick={() => act({ act: "fold" })}>
                      Fold
                    </Button>
                  ) : null}
                  {legal.canCheck ? (
                    <Button variant="outline" onClick={() => act({ act: "check" })}>
                      Check
                    </Button>
                  ) : null}
                  {legal.canCall ? (
                    <Button onClick={() => act({ act: "call" })}>Call {legal.toCall.toLocaleString("en-US")}</Button>
                  ) : null}
                  {legal.canBet ? (
                    <Button variant="secondary" onClick={() => setSizing([legal.minBetTo])}>
                      Bet
                    </Button>
                  ) : null}
                  {legal.canRaise ? (
                    <Button variant="secondary" onClick={() => setSizing([legal.minRaiseTo])}>
                      Raise
                    </Button>
                  ) : null}
                  <Button className="col-span-2" onClick={() => act({ act: "allin" })}>
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
                    className="mt-3 w-full"
                    onClick={() => act(legal.canBet ? { act: "bet", to: sizing[0] } : { act: "raise", to: sizing[0] })}
                  >
                    Confirm
                  </Button>
                </div>
              ) : null}
              {!yourTurn && hand.phase !== "done" ? (
                <p className="text-center text-sm text-[#d5c7ae]">
                  {hand.phase === "act" ? "Kaiji has the action." : "The next card is coming."}
                </p>
              ) : null}
            </div>
          </div>
        )}
      </div>

      <aside className="flex flex-col gap-3">
        <div className="rounded-xl border bg-card p-3">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Session chips</p>
          <p className="mt-1 text-sm">You {formatChips(nets[0])}</p>
          <p className="text-sm">Kaiji {formatChips(nets[1])}</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {dealt} hand{dealt === 1 ? "" : "s"} dealt. Kaiji still only checks or shoves. This table does not move the ladder.
          </p>
        </div>
      </aside>
    </section>
  );
}
