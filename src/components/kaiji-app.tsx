"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Settings } from "lucide-react";
import { PlayingCard } from "@/components/cards";
import { LineChart, type ChartLine } from "@/components/elo-chart";
import { HeadsUp } from "@/components/heads-up";
import { SixMax } from "@/components/six-max";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DEFAULT_MATCH_DEADLINE,
  HANDS_PER_MATCH,
  TIER_LABEL,
  TIERS,
  asset,
  formatChips,
  formatElo,
  formatMatchTime,
} from "@/lib/constants";
import { SimController, type LadderRow, type SimSnap } from "@/lib/controller";
import { kaijiPopulationCount } from "@/lib/field";
import { formatHandsPerSec, formatSpeed, sliderPosition, speedFromPosition, speedPresets } from "@/lib/pace";
import { TIER_GRADES, type TierGrade, type TierListCard } from "@/lib/tier-list";
import type { HistoryPoint } from "@/lib/storage";

const TIER_COLORS: Record<(typeof TIERS)[number], string> = {
  gto: "#7dcea0",
  dynamic: "#5dade2",
  frozen: "#f4d03f",
  agentic: "#c39bd3",
};
const STREETS = ["Preflop", "Flop", "Turn", "River"];

export function KaijiApp() {
  const simRef = useRef<SimController | null>(null);
  const [snap, setSnap] = useState<SimSnap | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [seed, setSeed] = useState("kaiji-2026");
  const [bots, setBots] = useState("1200");
  const [kaijiShare, setKaijiShare] = useState("0");
  const [ladderCut, setLadderCut] = useState<20 | 100>(20);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [matchDraft, setMatchDraft] = useState(String(DEFAULT_MATCH_DEADLINE));
  const [deadlineFocus, setDeadlineFocus] = useState(false);
  const [deadlineError, setDeadlineError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("table");
  const [simOpen, setSimOpen] = useState(true);

  useEffect(() => {
    const sim = new SimController();
    simRef.current = sim;
    const unsubscribe = sim.subscribe(() => setSnap(sim.snapshot()));
    sim.boot();
    return () => {
      unsubscribe();
      sim.dispose();
    };
  }, []);

  useEffect(() => {
    if (!snap) return;
    if (!deadlineFocus) setMatchDraft(String(snap.matchDeadline));
  }, [snap, deadlineFocus]);

  const hits = simRef.current?.findBots(query) ?? [];

  const tierLines = useMemo<ChartLine[]>(() => {
    if (!snap) return [];
    return [
      { name: "Kaiji", color: "#ff5d5d", value: (point: HistoryPoint) => point.kaiji },
      ...TIERS.map((tier) => ({
        name: TIER_LABEL[tier],
        color: TIER_COLORS[tier],
        value: (point: HistoryPoint) => point.tiers[tier],
      })),
    ];
  }, [snap]);

  const chipLines = useMemo<ChartLine[]>(() => {
    return [
      { name: "Kaiji", color: "#ff5d5d", value: (point: HistoryPoint) => point.kaijiChips },
      ...TIERS.map((tier) => ({
        name: TIER_LABEL[tier],
        color: TIER_COLORS[tier],
        value: (point: HistoryPoint) => point.tierChips[tier],
      })),
    ];
  }, []);

  if (!snap || snap.phase === "loading") {
    return (
      <main className="grid min-h-screen place-items-center px-6">
        <div className="max-w-sm text-center">
          <img src={asset("/kaiji.png")} alt="Kaiji" className="pixel-art mx-auto size-16 border-2 border-black shadow-[4px_4px_0_#000]" />
          <p className="mt-4 font-display text-xs text-[#ff6b6b]">ざわ…</p>
          <h1 className="mt-2 text-xl">Counting the chips</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            The field is being seated from the seed. Nothing has been dealt yet.
          </p>
        </div>
      </main>
    );
  }

  function applyMatchDraft(value: string) {
    setMatchDraft(value);
    const matches = Number(value);
    if (!Number.isInteger(matches) || matches < 1) {
      setDeadlineError("Match deadline needs a whole number of at least 1.");
      return;
    }
    if (!simRef.current) return;
    setDeadlineError(simRef.current.setMatchDeadline(matches));
  }

  const typedMatches = Number(matchDraft);
  const shownMatches = Number.isInteger(typedMatches) && typedMatches >= 1 ? typedMatches : snap.matchDeadline;
  const matchWord = shownMatches === 1 ? "match" : "matches";
  const matchStopCopy = `${shownMatches.toLocaleString("en-US")} ${matchWord} = ${(shownMatches * HANDS_PER_MATCH).toLocaleString("en-US")} hands`;

  function submitSetup() {
    if (!simRef.current) return;
    const message = simRef.current.newRun(seed, Number(bots), Number(kaijiShare));
    if (message) setSetupError(message);
    else {
      setSetupError(null);
      setSetupOpen(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-4 px-3 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
      <header className="flex flex-wrap items-center gap-3">
        <img src={asset("/kaiji.png")} alt="Kaiji" className="pixel-art size-12 border-2 border-black shadow-[3px_3px_0_#000] sm:size-14" />
        <div className="min-w-0 flex-1">
          <p className="font-display text-[10px] tracking-[0.35em] text-[#ff6b6b]">ざわ…ざわ…</p>
          <h1 className="font-display text-sm sm:text-base">Texas Poker Kaiji</h1>
          <p className="hidden text-sm text-muted-foreground sm:block">A static shove, sat against a field that is allowed to change its mind.</p>
        </div>
        <Button
          type="button"
          className="min-h-11 min-w-11 px-3"
          variant={simOpen ? "default" : "outline"}
          aria-pressed={simOpen}
          aria-label={simOpen ? "Hide match controls" : "Show match controls"}
          onClick={() => setSimOpen((value) => !value)}
        >
          <Settings className="size-5" />
        </Button>
        <div className="ml-auto flex gap-2">
          <div className="min-w-[5.5rem] rounded-xl border bg-card px-3 py-2 text-right max-sm:min-w-[4.5rem] max-sm:px-2 max-sm:py-1">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Win rate</p>
            <p className="font-display text-base text-[#e2b657] sm:text-lg">{winRateLabel(snap)}</p>
            <p className="hidden text-[10px] text-muted-foreground sm:block">{winRateDetail(snap)}</p>
          </div>
          <div className="min-w-[5.5rem] rounded-xl border bg-card px-3 py-2 text-right max-sm:min-w-[4.5rem] max-sm:px-2 max-sm:py-1">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{snap.locked ? "Locked Elo" : "Kaiji Elo"}</p>
            <p className="font-display text-base text-[#ff5d5d] sm:text-lg">{formatElo(snap.kaijiElo)}</p>
          </div>
        </div>
      </header>

      {snap.lockCopy ? (
        <div className="rounded-xl border border-[#e2b657] bg-[#2a2110] px-4 py-3">
          <p className="font-display text-[10px] text-[#e2b657]">The window is shut</p>
          <p className="mt-1 text-sm leading-relaxed">{snap.lockCopy}</p>
        </div>
      ) : null}
      {snap.error ? (
        <div className="rounded-xl border border-destructive/60 bg-destructive/10 px-4 py-3 text-sm">
          The table stopped: {snap.error} Start a new run to clear the saved ladder.
        </div>
      ) : null}
      {snap.notice ? <p className="text-sm text-muted-foreground">{snap.notice}</p> : null}

      {simOpen ? (
      <section className="grid gap-3 rounded-xl border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          {snap.running ? (
            <Button className="min-h-11" onClick={() => simRef.current?.pause()}>Pause</Button>
          ) : (
            <Button className="min-h-11" onClick={() => simRef.current?.start()} disabled={snap.locked || snap.phase === "error"}>
              {snap.handsPlayed === 0 ? "Open the table" : "Deal"}
            </Button>
          )}
          {speedPresets(snap.speedCap ?? 1).map((preset) => (
            <Button
              key={preset}
              className="min-h-11 min-w-11 px-2"
              variant={snap.speed === preset ? "default" : "outline"}
              disabled={snap.speedCap == null && preset !== 1}
              onClick={() => simRef.current?.setSpeed(preset)}
            >
              {formatSpeed(preset)}
            </Button>
          ))}
          <div className="min-w-40 flex-1">
            <Slider
              min={0}
              max={1000}
              step={1}
              disabled={snap.speedCap == null}
              value={[sliderPosition(snap.speed, snap.speedCap ?? 1)]}
              onValueChange={(value) => {
                const position = Array.isArray(value) ? value[0] : value;
                simRef.current?.setSpeed(speedFromPosition(position, snap.speedCap ?? 1));
              }}
              aria-label={`Simulation speed ${formatSpeed(snap.speed)}`}
            />
          </div>
          <span className="min-w-16 text-right text-sm tabular-nums">{formatSpeed(snap.speed)}</span>
          <span className="min-w-[7.5rem] text-right text-sm tabular-nums text-muted-foreground">
            {snap.handsPerSec == null ? "— hands/s" : formatHandsPerSec(snap.handsPerSec)}
          </span>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {paceCopy(snap)}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <Label className="gap-2 pb-1">
            <Switch checked={snap.blinds} onCheckedChange={(checked) => simRef.current?.setBlinds(checked)} />
            Blind bet required
          </Label>
          <div className="grid gap-1">
            <Label htmlFor="match-deadline">Match deadline</Label>
            <Input
              id="match-deadline"
              inputMode="numeric"
              value={matchDraft}
              disabled={snap.locked}
              onFocus={() => setDeadlineFocus(true)}
              onBlur={() => {
                setDeadlineFocus(false);
                if (!Number.isInteger(Number(matchDraft)) || Number(matchDraft) < 1) {
                  setMatchDraft(String(snap.matchDeadline));
                  setDeadlineError(null);
                }
              }}
              onChange={(event) => applyMatchDraft(event.target.value)}
            />
          </div>
          <div className="pb-2 text-sm leading-relaxed text-muted-foreground">
            <p>{matchStopCopy}</p>
            <p>240 hands per match</p>
          </div>
          <Button
            className="min-h-11"
            variant="outline"
            onClick={() => {
              setSeed(snap.seed);
              setBots(String(snap.botCount));
              setKaijiShare(String(snap.kaijiShare));
              setSetupError(null);
              setSetupOpen(true);
            }}
          >
            New run
          </Button>
        </div>
        {deadlineError ? <p className="text-sm text-[#ffb4b4]">{deadlineError}</p> : null}
        <p className="text-xs leading-relaxed text-muted-foreground">
          Match {snap.matchesCompleted.toLocaleString("en-US")} / {snap.matchDeadline.toLocaleString("en-US")}
          {" · "}
          {snap.handsPlayed.toLocaleString("en-US")} / {snap.handDeadline.toLocaleString("en-US")} hands
          {" · "}
          Kaiji seated {snap.kaijiMatches.toLocaleString("en-US")}
          {" · "}
          Kaiji chart on {snap.kaijiPopulation.toLocaleString("en-US")} of {snap.botCount.toLocaleString("en-US")} players ({snap.kaijiShare}%)
          {" · "}
          {snap.clock}
          {snap.blinds ? " · Blinds 50/100" : " · No forced blinds"}
          {snap.blindsMixed ? " · Blinds changed during the run" : ""}
        </p>
      </section>
      ) : (
        <p className="text-xs text-muted-foreground">
          Match {snap.matchesCompleted.toLocaleString("en-US")} / {snap.matchDeadline.toLocaleString("en-US")}. The gear brings the speed and the deadline back.
        </p>
      )}

      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = String(value);
          setTab(next);
          if (next === "heads" || next === "six") setSimOpen(false);
          if (next === "table") setSimOpen(true);
        }}
      >
        <TabsList className="flex h-auto w-full flex-wrap max-sm:h-11 max-sm:flex-nowrap max-sm:justify-start max-sm:overflow-x-auto">
          <TabsTrigger className="min-h-11 px-3 max-sm:flex-none max-sm:shrink-0" value="table">The table</TabsTrigger>
          <TabsTrigger className="min-h-11 px-3 max-sm:flex-none max-sm:shrink-0" value="ladder">Ladder</TabsTrigger>
          <TabsTrigger className="min-h-11 px-3 max-sm:flex-none max-sm:shrink-0" value="tiers">Tier list</TabsTrigger>
          <TabsTrigger className="min-h-11 px-3 max-sm:flex-none max-sm:shrink-0" value="experiment">Experiment</TabsTrigger>
          <TabsTrigger className="min-h-11 px-3 max-sm:flex-none max-sm:shrink-0" value="heads">Heads-up</TabsTrigger>
          <TabsTrigger className="min-h-11 px-3 max-sm:flex-none max-sm:shrink-0" value="six">Six-max</TabsTrigger>
          <TabsTrigger className="min-h-11 px-3 max-sm:flex-none max-sm:shrink-0" value="rules">Rules</TabsTrigger>
        </TabsList>

        <TabsContent value="table" className="mt-3">
          <TablePanel snap={snap} />
        </TabsContent>
        <TabsContent value="ladder" className="mt-3">
          <LadderPanel snap={snap} cut={ladderCut} setCut={setLadderCut} />
        </TabsContent>
        <TabsContent value="tiers" className="mt-3">
          <TierListPanel snap={snap} />
        </TabsContent>
        <TabsContent value="experiment" className="mt-3 space-y-4">
          <ExperimentPanel snap={snap} tierLines={tierLines} chipLines={chipLines} query={query} setQuery={setQuery} hits={hits} />
        </TabsContent>
        <TabsContent value="heads" className="mt-3">
          <HeadsUp
            blinds={snap.blinds}
            locked={snap.locked}
            ladder={snap.ladder}
            fieldDuels={snap.fieldDuels}
            yourElo={snap.yourElo}
            pickOpponent={(pool) => simRef.current?.practiceOpponent(pool) ?? null}
            liveRatings={(botId) => simRef.current?.practiceRatings(botId) ?? { own: 1500, you: snap.yourElo }}
            rateMatch={(botId, nets) => simRef.current?.rateYourMatch(botId, nets) ?? null}
            tickField={(excludeId) => simRef.current?.tickFieldDuel(excludeId)}
          />
        </TabsContent>
        <TabsContent value="six" className="mt-3">
          <SixMax
            blinds={snap.blinds}
            locked={snap.locked}
            seed={snap.seed}
            players={snap.botCount}
            ladder={snap.ladder}
            fieldDuels={snap.fieldDuels}
            yourElo={snap.yourElo}
            seatFive={(requests) => simRef.current?.seatFive(requests) ?? { seats: null, error: "The table is not ready." }}
            findPlayers={(query) => simRef.current?.findBots(query) ?? []}
            liveRatings={(botId) => simRef.current?.practiceRatings(botId) ?? { own: 1500, you: snap.yourElo }}
            rateTable={(opponents, nets) => simRef.current?.rateYourTable(opponents, nets) ?? null}
            tickField={(excludeIds) => simRef.current?.tickFieldDuels(excludeIds)}
            bots={() => simRef.current?.fieldBots() ?? []}
          />
        </TabsContent>
        <TabsContent value="rules" className="mt-3">
          <RulesPanel />
        </TabsContent>
      </Tabs>

      <Dialog open={setupOpen} onOpenChange={setSetupOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Burn this ladder?</DialogTitle>
            <DialogDescription>
              A new seed reseats the field and puts every rating back at 1,500, including Kaiji. The old line stays in this browser only until you overwrite it.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1">
              <Label htmlFor="seed">Seed</Label>
              <Input id="seed" value={seed} onChange={(event) => setSeed(event.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="bots">Players</Label>
              <Input id="bots" inputMode="numeric" value={bots} onChange={(event) => setBots(event.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="kaiji-share">Kaiji population %</Label>
              <Input
                id="kaiji-share"
                inputMode="numeric"
                value={kaijiShare}
                onChange={(event) => setKaijiShare(event.target.value)}
              />
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Set this here, when the run starts. {populationCopy(bots, kaijiShare)} The real Kaiji is one more player and always uses the chart. There are no teams. 50 to 1,200 players, default 1,200. The same seed repeats the deals.
            </p>
            {setupError ? <p className="text-sm text-[#ffb4b4]">{setupError}</p> : null}
          </div>
          <DialogFooter>
            <Button className="min-h-11" variant="outline" onClick={() => setSetupOpen(false)}>
              Keep playing
            </Button>
            <Button className="min-h-11" onClick={submitSetup}>Reset the ladder</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function TablePanel({ snap }: { snap: SimSnap }) {
  const table = snap.table;
  if (!table) {
    return (
      <div className="felt grid min-h-80 place-items-center rounded-[2rem] px-6 text-center">
        <div>
          <p className="font-display text-xs text-[#e2b657]">The room is quiet</p>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[#f6efe2]">
            No hand is open. {snap.botCount.toLocaleString("en-US")} bots are waiting under seed {snap.seed}. Open the table when you want the first six seats.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="felt rounded-[2rem] px-3 py-4 sm:px-6">
        <div className="mb-3 text-center">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[#e2b657]">
            Match {table.matchIndex + 1} · hand {table.matchHands} / 240 · {table.done ? "Hand over" : STREETS[table.street]}
          </p>
          <p className="mt-1 text-sm text-[#f6efe2]">Pot {table.pot.toLocaleString("en-US")}</p>
          <p className="text-sm text-[#d5c7ae]">{table.lastAction || "Cards are out."}</p>
          <div className="mt-3 flex min-h-16 flex-wrap justify-center gap-1">
            {table.board.length === 0 ? <span className="self-center text-xs text-[#d5c7ae]">Board not dealt</span> : null}
            {table.board.map((card) => (
              <PlayingCard key={`${table.matchIndex}-${card}`} card={card} />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
          {table.seats.map((seat, index) => (
            <article
              key={`${seat.team}-${index}`}
              className={`rounded-xl border bg-black/40 p-2 text-left ${seat.isActor ? "border-[#e2b657]" : "border-black/50"} ${seat.folded ? "opacity-50" : ""} ${table.winners.includes(index) && table.done ? "ring-2 ring-[#e2b657]" : ""}`}
            >
              <div className="flex items-center gap-2">
                {seat.isKaiji ? (
                  <img src={asset("/kaiji.png")} alt="" className="pixel-art size-8 border border-black" />
                ) : (
                  <span className="grid size-8 place-items-center border border-black bg-[#2a211b] text-[10px]">{index + 1}</span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-[#f6efe2]">
                    {seat.name}
                    {seat.isButton ? " · BTN" : ""}
                  </p>
                  <p className="truncate text-[11px] text-[#d5c7ae]">
                    {seat.style} · {formatElo(seat.elo)}
                    {seat.isActor ? " · to act" : ""}
                    {seat.allin ? " · all-in" : ""}
                  </p>
                </div>
              </div>
              <div className="mt-2 flex gap-1">
                {seat.holes.map((card) => (
                  <PlayingCard key={card} card={card} small />
                ))}
              </div>
              <p className="mt-1 text-xs text-[#f6efe2]">
                Stack {seat.stack.toLocaleString("en-US")}
                {seat.put > 0 ? ` · in ${seat.put.toLocaleString("en-US")}` : ""}
              </p>
              <p className="text-[11px] text-[#d5c7ae]">Match {formatChips(table.matchNets[index] ?? 0)}</p>
            </article>
          ))}
        </div>
      </div>
      {snap.running && snap.speed === 1 ? null : (
        <p className="text-xs text-muted-foreground">
          {snap.speed === 1
            ? "1× walks every action."
            : "High speed batches hands and keeps the chart moving. The cards you see are a sample, not every action."}
        </p>
      )}
    </div>
  );
}

function paceCopy(snap: SimSnap): string {
  const players = (snap.benchPlayers || snap.botCount).toLocaleString("en-US");
  const blinds = (snap.benchPlayers ? snap.benchBlinds : snap.blinds) ? "blinds on" : "blinds off";
  if (snap.speedCap == null) {
    return `Measuring pace for ${snap.botCount.toLocaleString("en-US")} players, ${snap.blinds ? "blinds on" : "blinds off"}. 1× keeps dealing one action at a time.`;
  }
  const held = snap.benchHandsPerSec == null ? "" : ` It held ${formatHandsPerSec(snap.benchHandsPerSec)}.`;
  const again = snap.pacing ? " Measuring the current room." : "";
  return `Bench: ${players} players, ${blinds}. Solver GTO stays in the field. The slider stops at ${formatSpeed(snap.speedCap)}.${held}${again}`;
}

function winRateLabel(snap: SimSnap): string {
  if (snap.winrateTracked <= 0) return "—";
  return `${Math.round((snap.kaijiWins / snap.winrateTracked) * 100)}%`;
}

function winRateDetail(snap: SimSnap): string {
  if (snap.winrateTracked <= 0) return snap.kaijiMatches > 0 ? "from the next match" : "no match yet";
  return `${snap.kaijiWins} / ${snap.winrateTracked} first`;
}

function populationCopy(bots: string, share: string): string {
  const count = Number(bots);
  const pct = Number(share);
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(pct) || pct < 0 || pct > 100) {
    return "Use a whole percent from 0 to 100.";
  }
  const marked = kaijiPopulationCount(count, pct);
  return `${marked.toLocaleString("en-US")} of ${count.toLocaleString("en-US")} players use Kaiji's chart from the first hand.`;
}

type LadderSort = "rank" | "name" | "style" | "elo";

function compareLadder(a: LadderRow, b: LadderRow, key: LadderSort, dir: 1 | -1): number {
  let delta = 0;
  if (key === "name") delta = a.name.localeCompare(b.name);
  else if (key === "style") delta = a.style.localeCompare(b.style) || a.name.localeCompare(b.name);
  else if (key === "elo") delta = a.elo - b.elo;
  else delta = a.rank - b.rank;
  if (delta === 0) delta = a.rank - b.rank;
  return delta * dir;
}

function LadderPanel({
  snap,
  cut,
  setCut,
}: {
  snap: SimSnap;
  cut: 20 | 100;
  setCut: (cut: 20 | 100) => void;
}) {
  const [sortKey, setSortKey] = useState<LadderSort>("rank");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  function sortBy(key: LadderSort) {
    if (sortKey === key) setSortDir((dir) => (dir === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(key === "elo" ? -1 : 1);
    }
  }
  const rows = snap.ladder.slice().sort((a, b) => compareLadder(a, b, sortKey, sortDir)).slice(0, cut);
  const kaijiShown = rows.some((row) => row.isHero);
  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-display text-[10px] text-[#e2b657]">By player</p>
          <h2 className="mt-1 text-lg">The ladder</h2>
        </div>
        <div className="flex gap-2">
          <Button className="min-h-11" variant={cut === 20 ? "default" : "outline"} onClick={() => setCut(20)}>
            Show 20
          </Button>
          <Button className="min-h-11" variant={cut === 100 ? "default" : "outline"} onClick={() => setCut(100)}>
            Show 100
          </Button>
        </div>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Rank is standing by Elo. 1 is the highest rating, and a tie breaks by name, so every player has their own number. It moves when a rated match ends, including heads-up matches in that tab. Kaiji is rank {snap.kaijiRank.toLocaleString("en-US")} of {snap.fieldSize.toLocaleString("en-US")}. Click a column to sort. Show 20 and Show 100 keep that order.
      </p>
      <div className="mt-3 max-h-[70dvh] overflow-auto">
        <table className="w-full min-w-[20rem] text-left text-sm">
          <thead className="sticky top-0 bg-card text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <SortHeader label="Rank" column="rank" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
              <SortHeader label="Player" column="name" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
              <SortHeader label="Style" column="style" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
              <SortHeader label="Elo" column="elo" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
              <th className="py-2 font-medium">Matches</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={`border-t ${row.isHero ? "bg-[#3a1818]" : ""}`}>
                <td className="py-2 pr-3 tabular-nums">{row.rank}</td>
                <td className="py-2 pr-3">{row.name}</td>
                <td className="py-2 pr-3 text-muted-foreground">{row.style}</td>
                <td className="py-2 pr-3 tabular-nums">{formatElo(row.elo)}</td>
                <td className="py-2 tabular-nums">{row.matches.toLocaleString("en-US")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!kaijiShown ? (
        <p className="mt-3 text-sm text-muted-foreground">Kaiji is outside this page, at rank {snap.kaijiRank.toLocaleString("en-US")}.</p>
      ) : null}
    </section>
  );
}

function SortHeader({
  label,
  column,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  column: LadderSort;
  sortKey: LadderSort;
  sortDir: 1 | -1;
  onSort: (column: LadderSort) => void;
}) {
  const active = sortKey === column;
  return (
    <th className="py-1 pr-3 font-medium" aria-sort={active ? (sortDir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className="min-h-11 text-left uppercase tracking-wide" onClick={() => onSort(column)}>
        {label}
        {active ? (sortDir === 1 ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
}

const GRADE_INK: Record<TierGrade, string> = {
  "S+": "#e2b657",
  S: "#f6e7b4",
  A: "#7dcea0",
  B: "#5dade2",
  C: "#c39bd3",
  D: "#e0a36a",
  F: "#e07a7a",
};

function TierListPanel({ snap }: { snap: SimSnap }) {
  const cards = snap.tierList;
  if (!cards) {
    return (
      <section className="rounded-xl border border-dashed p-4">
        <p className="font-display text-[10px] text-[#e2b657]">After the lock</p>
        <h2 className="mt-1 text-lg">Tier list</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          This list is written when the run locks. Finish the match deadline, or the hand deadline, and each style is placed from S+ down to F by its final average Elo. The ladder keeps every player. This tab keeps one card per style.
        </p>
      </section>
    );
  }
  const byGrade = new Map<TierGrade, TierListCard[]>();
  for (const grade of TIER_GRADES) byGrade.set(grade, []);
  for (const card of cards) byGrade.get(card.grade)?.push(card);
  const shared = new Set(cards.map((card) => card.grade)).size === 1;
  return (
    <section className="rounded-xl border bg-card p-4">
      <p className="font-display text-[10px] text-[#e2b657]">Locked run</p>
      <h2 className="mt-1 text-lg">Tier list</h2>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
        {snap.lockCopy} Grades are this run&apos;s order, from the highest style average at S+ to the lowest at F. Elo that rounds to the same number shares a grade. Kaiji is his own card. Chart copies are one card. Each personality still playing its own strategy is one card.
        {snap.yourMatches > 0 ? " You are on the list because a heads-up sit was rated." : " You stay off the list until a heads-up sit is rated."}
      </p>
      {shared ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Every style rounded to the same Elo, so the whole room sits in {cards[0]?.grade ?? "B"}.
        </p>
      ) : null}
      <ol className="mt-4 space-y-2">
        {TIER_GRADES.map((grade) => {
          const row = byGrade.get(grade) ?? [];
          return (
            <li key={grade} className="grid grid-cols-1 gap-2 rounded-xl border p-2 sm:grid-cols-[4.75rem_1fr] sm:items-stretch">
              <div
                className="flex min-h-11 items-center justify-center rounded-lg"
                style={{ backgroundColor: `${GRADE_INK[grade]}22` }}
              >
                <span className="font-display text-2xl leading-none" style={{ color: GRADE_INK[grade] }}>
                  {grade}
                </span>
              </div>
              {row.length === 0 ? (
                <p className="self-center px-2 text-sm text-muted-foreground">No style landed here.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {row.map((card) => (
                    <article key={card.id} className="min-w-[10.5rem] flex-1 rounded-lg border bg-black/30 px-3 py-2 sm:max-w-[16rem]">
                      <p className="font-medium">{card.name}</p>
                      {card.family !== card.name ? <p className="text-xs text-muted-foreground">{card.family}</p> : null}
                      <p className="mt-1 tabular-nums">{formatElo(card.elo)}</p>
                      <p className="text-xs text-muted-foreground">{card.players === 1 ? "1 player" : `${card.players.toLocaleString("en-US")} players`}</p>
                      {card.players > 1 ? (
                        <p className="text-xs text-muted-foreground">
                          Best {card.bestName} · {formatElo(card.bestElo)}
                        </p>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function ExperimentPanel({
  snap,
  tierLines,
  chipLines,
  query,
  setQuery,
  hits,
}: {
  snap: SimSnap;
  tierLines: ChartLine[];
  chipLines: ChartLine[];
  query: string;
  setQuery: (value: string) => void;
  hits: ReturnType<SimController["findBots"]>;
}) {
  return (
    <>
      <section className="rounded-xl border bg-card p-4">
        <p className="font-display text-[10px] text-[#e2b657]">The claim</p>
        <h2 className="mt-1 text-lg">Updating the strategy is wasted work</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          A friend says the chart does not need another revision. In this room — six seats, 240 hands, 10,000 fresh chips, Elo from how you place — the static Kaiji shove is the best policy you can sit down with. The lines below are computed from this run. Nothing here is a planted winner.
        </p>
      </section>

      {snap.history.length === 0 ? (
        <section className="rounded-xl border border-dashed p-4">
          <h3 className="text-base">No match has been scored</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Kaiji is still {formatElo(snap.kaijiElo)}, the same chair as the rest of the room. Deal at least one full match and the Elo lines will move. Each style line is the average rating of players of that style who have sat, not a pile of all of them added together. A rated match is 240 hands. If the hand total cuts a match short, that match is not rated.
          </p>
        </section>
      ) : (
        <>
          <section className="rounded-xl border bg-card p-4">
            <h3 className="text-base">Kaiji against the four tiers</h3>
            <p className="mb-2 text-xs text-muted-foreground">
              Each line is the average Elo of players of that style who have sat. GTO-style and Dynamic-by-Elo looked much faster before because the chart added every one of their Elo changes into a single number and drew it on Kaiji&apos;s scale. This field has {snap.tierCounts.gto.toLocaleString("en-US")} GTO-style, {snap.tierCounts.dynamic.toLocaleString("en-US")} dynamic, {snap.tierCounts.frozen.toLocaleString("en-US")} frozen, and {snap.tierCounts.agentic.toLocaleString("en-US")} adapters. Kaiji is one player, so only his own change hits his line. Right now those averages are GTO {formatElo(snap.tiers.gto)}, dynamic {formatElo(snap.tiers.dynamic)}, frozen {formatElo(snap.tiers.frozen)}, adapters {formatElo(snap.tiers.agentic)}. The group piles, which are not ratings, are GTO {formatElo(snap.tierPiles.gto)}, dynamic {formatElo(snap.tierPiles.dynamic)}, frozen {formatElo(snap.tierPiles.frozen)}, adapters {formatElo(snap.tierPiles.agentic)}.
            </p>
            <LineChart points={snap.history} lines={tierLines} empty="" />
          </section>
          <section className="rounded-xl border bg-card p-4">
            <h3 className="text-base">Cumulative chips</h3>
            <p className="mb-2 text-xs text-muted-foreground">
              Chips are the slide&apos;s score: end stack minus 10,000, summed over hands. A tier line adds every seat of that style, so two GTO players in one match both count. That group total can rise faster than Kaiji even when each of those players is an ordinary rating.
            </p>
            <LineChart points={snap.history} lines={chipLines} empty="" />
          </section>
        </>
      )}

      <section className="rounded-xl border bg-card p-4">
        <h3 className="text-base">Evidence</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Sample: {snap.matchesCompleted.toLocaleString("en-US")} rated matches, {snap.handsPlayed.toLocaleString("en-US")} hands, Kaiji seated {snap.kaijiMatches.toLocaleString("en-US")} times.
          {snap.kaijiMatches < 8 && snap.matchesCompleted > 0 ? " Small sample — the ranking is still noisy." : ""}
        </p>
        {snap.verdict ? (
          <>
            <p className="mt-3 text-sm">{snap.verdict.summary}</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[28rem] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Who</th>
                    <th className="py-1 pr-3 font-medium">Average Elo</th>
                    <th className="py-1 pr-3 font-medium">Versus Kaiji</th>
                    <th className="py-1 pr-3 font-medium">Group pile</th>
                    <th className="py-1 font-medium">Chips</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t">
                    <td className="py-2 pr-3">Kaiji</td>
                    <td className="py-2 pr-3 tabular-nums">{formatElo(snap.kaijiElo)}</td>
                    <td className="py-2 pr-3">—</td>
                    <td className="py-2 pr-3">—</td>
                    <td className="py-2 tabular-nums">{formatChips(snap.kaijiChips)}</td>
                  </tr>
                  {snap.verdict.rows.map((row) => (
                    <tr key={row.tier} className="border-t">
                      <td className="py-2 pr-3">{row.label}</td>
                      <td className="py-2 pr-3 tabular-nums">{formatElo(row.elo)}</td>
                      <td className="py-2 pr-3">
                        {row.result === "ahead" ? `Kaiji ahead by ${row.delta}` : row.result === "behind" ? `Kaiji behind by ${Math.abs(row.delta)}` : "Level"}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{formatElo(snap.tierPiles[row.tier])}</td>
                      <td className="py-2 tabular-nums">{formatChips(snap.tierChips[row.tier])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No comparison yet. The friend&apos;s claim is still untested on this seed.</p>
        )}
      </section>

      <section className="rounded-xl border bg-card p-4">
        <h3 className="text-base">The field</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {snap.botCount.toLocaleString("en-US")} variants. GTO {snap.tierCounts.gto.toLocaleString("en-US")}, dynamic {snap.tierCounts.dynamic.toLocaleString("en-US")}, frozen {snap.tierCounts.frozen.toLocaleString("en-US")}, adapters {snap.tierCounts.agentic.toLocaleString("en-US")}. GTO-style plays a Discounted CFR mix from postflop-solver: the button-versus-blind ranges before the flop, then that solver&apos;s check, 66% pot, call, and fold frequencies. Frozen personalities were fixed when the seed was created. Adapters only rewrite their own thresholds from hands they sat.
        </p>
        <Label htmlFor="bot-search" className="mt-3">
          Find a bot
        </Label>
        <Input
          id="bot-search"
          className="mt-1"
          placeholder="Ash Fox, maniac, North Door…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query.trim() && hits.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nobody in this field goes by that name.</p>
        ) : (
          <ul className="mt-3 divide-y">
            {hits.map((hit) => (
              <li key={hit.id} className="py-2 text-sm">
                <p>
                  {hit.name} <span className="text-muted-foreground">· {hit.id}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {hit.style} · Elo {formatElo(hit.elo)} · {hit.matches} rated
                </p>
                <p className="text-xs text-muted-foreground">{hit.note}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-xs text-muted-foreground">
        Default window: {formatMatchTime(0)} through the match that starts {formatMatchTime(DEFAULT_MATCH_DEADLINE - 1)}, one match every 10 minutes, {DEFAULT_MATCH_DEADLINE.toLocaleString("en-US")} matches.
      </p>
    </>
  );
}

function RulesPanel() {
  return (
    <article className="max-w-3xl space-y-4 text-sm leading-relaxed">
      <section className="rounded-xl border bg-card p-4">
        <h2 className="text-base">What the slides fix</h2>
        <p className="mt-2 text-muted-foreground">
          Six-handed Texas Hold&apos;em. Fold, check, call, bet, raise, or all-in. Standard ranks, and a tie splits the pot. A policy sees its own hole cards and the public action, never another player&apos;s cards. One match is 240 hands with the button moving each hand. Every hand starts from a fresh 10,000-chip stack. The table is ranked by cumulative net chips, end stack minus 10,000.
        </p>
      </section>
      <section className="rounded-xl border bg-card p-4">
        <h2 className="text-base">Elo</h2>
        <p className="mt-2 text-muted-foreground">
          This room starts every player at 1,500. For six players, place score is (6 − place) / 5, and a tie splits the average of the tied places. Expected score is the mean of logistic Elo expectations against each opponent, base 10, divisor 400. The update is rating plus 32 times score minus expected score. The slides illustrate that formula with a 1,760 player: a win against a 1,560 is about +7.69, which rounds to their +8. Their +17 against a 1,960 is an illustration; this K lands near +24. K stays 32 either way.
        </p>
      </section>
      <section className="rounded-xl border bg-card p-4">
        <h2 className="text-base">Blinds, and when they are off</h2>
        <p className="mt-2 text-muted-foreground">
          The slides never set a blind size. With the switch on, the small blind is 50 and the big blind is 100. With the switch off, nobody posts. The minimum opening bet stays 100 chips so a bet is still a real bet. If every player checks to showdown, the pot is 0 and every net is 0. Odd chips in a split go to the first winner left of the button. A short all-in reopens action; a player may always fold, call, or move all-in.
        </p>
      </section>
      <section className="rounded-xl border bg-card p-4">
        <h2 className="text-base">Kaiji</h2>
        <p className="mt-2 text-muted-foreground">
          Preflop he shoves every pocket pair and AK, AQ, AJ, AT, suited or not. Anything else checks if the call is free and folds if it costs chips. After the flop he shoves top pair or better: top pair, overpair, two pair, trips, straight, flush, full house, quads. Top pair and overpair have to use a hole card. Two pair or better shoves even when the board made the hand. He never changes this, and he never bets a size other than all-in.
        </p>
      </section>
      <section className="rounded-xl border bg-card p-4">
        <h2 className="text-base">Who else is in the room</h2>
        <p className="mt-2 text-muted-foreground">
          The field is individual players, from 50 up to 1,200. There are no teams. Four styles share that field: a fast GTO-style chart, dynamic bots whose tightness and aggression move with their own Elo and the table&apos;s Elo, frozen personalities fixed at creation, and adapters that rewrite thresholds from showdown rate, fold-to-shove, and aggression they actually saw. Each match seats the whole room for 240 hands. Kaiji&apos;s table is the one on screen. Every other player sits at an AI table, so a finished schedule gives every player the same number of matches as Kaiji. The ladder ranks each player by their own Elo. Win rate is the share of rated matches in which Kaiji tied or took the best chip result. Heads-up and six-max use the same rating formula. Your match is rated after 240 hands, and the rest of the field plays its own matches while that tab is open. Six-max seats you with five players: random five, or a style, personality, or name in each chair. A short sit is not rated. Host opens a table and Join sits a friend in an open chair; share the code or the #table link. Empty chairs become AIs when the host deals. The host deals, hole cards are encrypted to each seat, and that table does not move the ladder. A guest who disconnects keeps the chair and can sit back down with the same name. The host can kick a player, and can seat a random AI or tap a named player in an open chair. The name list is there even before a ladder run. If the host leaves, the game ends. The host cannot sit back down. A locked run does not move. Ratings stay in localStorage.
        </p>
      </section>
      <section className="rounded-xl border bg-card p-4">
        <h2 className="text-base">The deadline</h2>
        <p className="mt-2 text-muted-foreground">
          Poker on the slides is a forced match every 10 minutes. The default stop is the full window from 5 Oct 2026 00:00 UTC through the 23:50 UTC match on 11 Oct 2026: 1,008 matches. Each match is 240 hands, so that window is 241,920 hands. The hand total is the match count times 240 and rewrites itself when the match count changes. Whichever limit arrives first locks Kaiji&apos;s Elo. A match cut off before 240 hands is not rated. Kaiji&apos;s Elo on the lock is the last rated value. The Tier list tab stays empty until that lock, then places each style from S+ down to F by its average Elo.
        </p>
      </section>
    </article>
  );
}
