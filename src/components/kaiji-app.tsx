"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PlayingCard } from "@/components/cards";
import { LineChart, type ChartLine } from "@/components/elo-chart";
import { HeadsUp } from "@/components/heads-up";
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
  INITIAL_ELO,
  TIER_LABEL,
  TIERS,
  asset,
  formatChips,
  formatElo,
  formatMatchTime,
} from "@/lib/constants";
import { SimController, type SimSnap } from "@/lib/controller";
import type { HistoryPoint } from "@/lib/storage";

const TEAM_COLORS = ["#ff5d5d", "#e2b657", "#7dcea0", "#5dade2", "#c39bd3", "#f5b041", "#85c1e9", "#f1948a", "#73c6b6", "#f7dc6f", "#d2b4de", "#aeb6bf"];
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
  const [teams, setTeams] = useState("7");
  const [bots, setBots] = useState("1200");
  const [setupError, setSetupError] = useState<string | null>(null);
  const [matchDraft, setMatchDraft] = useState(String(DEFAULT_MATCH_DEADLINE));
  const [deadlineFocus, setDeadlineFocus] = useState(false);
  const [deadlineError, setDeadlineError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

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

  const teamLines = useMemo<ChartLine[]>(() => {
    if (!snap) return [];
    return snap.teamNames.map((name, index) => ({
      name,
      color: TEAM_COLORS[index % TEAM_COLORS.length],
      value: (point: HistoryPoint) => point.teams[index] ?? point.kaiji,
    }));
  }, [snap]);

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
          <p className="mt-4 font-display text-xs text-[#e2b657]">ざわ…</p>
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
    const message = simRef.current?.setMatchDeadline(matches) ?? "The table is not ready.";
    setDeadlineError(message);
  }

  const typedMatches = Number(matchDraft);
  const shownMatches = Number.isInteger(typedMatches) && typedMatches >= 1 ? typedMatches : snap.matchDeadline;
  const matchWord = shownMatches === 1 ? "match" : "matches";
  const matchStopCopy = `${shownMatches.toLocaleString("en-US")} ${matchWord} = ${(shownMatches * HANDS_PER_MATCH).toLocaleString("en-US")} hands`;

  function submitSetup() {
    const message = simRef.current?.newRun(seed, Number(teams), Number(bots)) ?? "The table is not ready.";
    if (message) setSetupError(message);
    else {
      setSetupError(null);
      setSetupOpen(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 px-3 py-4 sm:px-6">
      <header className="flex flex-wrap items-center gap-3">
        <img src={asset("/kaiji.png")} alt="Kaiji" className="pixel-art size-14 border-2 border-black shadow-[3px_3px_0_#000]" />
        <div className="min-w-0 flex-1">
          <p className="font-display text-[10px] tracking-[0.35em] text-[#e2b657]">ざわ…ざわ…</p>
          <h1 className="font-display text-sm sm:text-base">Texas Poker Kaiji</h1>
          <p className="text-sm text-muted-foreground">A static shove, sat against a field that is allowed to change its mind.</p>
        </div>
        <div className="rounded-xl border bg-card px-3 py-2 text-right">
          <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{snap.locked ? "Locked Elo" : "Kaiji Elo"}</p>
          <p className="font-display text-lg text-[#ff5d5d]">{formatElo(snap.kaijiElo)}</p>
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

      <section className="grid gap-3 rounded-xl border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          {snap.running ? (
            <Button onClick={() => simRef.current?.pause()}>Pause</Button>
          ) : (
            <Button onClick={() => simRef.current?.start()} disabled={snap.locked || snap.phase === "error"}>
              {snap.handsPlayed === 0 ? "Open the table" : "Deal"}
            </Button>
          )}
          {[1, 10, 100, 1000].map((preset) => (
            <Button key={preset} variant={snap.speed === preset ? "default" : "outline"} onClick={() => simRef.current?.setSpeed(preset)}>
              {preset}×
            </Button>
          ))}
          <div className="min-w-40 flex-1">
            <Slider
              min={1}
              max={1000}
              step={1}
              value={[snap.speed]}
              onValueChange={(value) => simRef.current?.setSpeed(Array.isArray(value) ? value[0] : value)}
              aria-label="Simulation speed"
            />
          </div>
          <span className="w-14 text-right text-sm tabular-nums">{snap.speed}×</span>
        </div>
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
            variant="outline"
            onClick={() => {
              setSeed(snap.seed);
              setTeams(String(snap.teamCount));
              setBots(String(snap.botCount));
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
          {snap.clock}
          {snap.blinds ? " · Blinds 50/100" : " · No forced blinds"}
          {snap.blindsMixed ? " · Blinds changed during the run" : ""}
        </p>
      </section>

      <Tabs defaultValue="table">
        <TabsList className="flex h-auto w-full flex-wrap">
          <TabsTrigger value="table">The table</TabsTrigger>
          <TabsTrigger value="experiment">Experiment</TabsTrigger>
          <TabsTrigger value="heads">Heads-up</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
        </TabsList>

        <TabsContent value="table" className="mt-3">
          <TablePanel snap={snap} />
        </TabsContent>
        <TabsContent value="experiment" className="mt-3 space-y-4">
          <ExperimentPanel snap={snap} teamLines={teamLines} tierLines={tierLines} chipLines={chipLines} query={query} setQuery={setQuery} hits={hits} />
        </TabsContent>
        <TabsContent value="heads" className="mt-3">
          <HeadsUp blinds={snap.blinds} />
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
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label htmlFor="teams">Teams</Label>
                <Input id="teams" inputMode="numeric" value={teams} onChange={(event) => setTeams(event.target.value)} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="bots">Bots</Label>
                <Input id="bots" inputMode="numeric" value={bots} onChange={(event) => setBots(event.target.value)} />
              </div>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Team 1 is Kaiji. Teams 2 onward split the bots and each must hold every tier. Use 6 to 12 teams and at least 1,000 bots.
            </p>
            {setupError ? <p className="text-sm text-[#ffb4b4]">{setupError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSetupOpen(false)}>
              Keep playing
            </Button>
            <Button onClick={submitSetup}>Reset the ladder</Button>
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
                    {seat.team} · {formatElo(seat.elo)}
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

function ExperimentPanel({
  snap,
  teamLines,
  tierLines,
  chipLines,
  query,
  setQuery,
  hits,
}: {
  snap: SimSnap;
  teamLines: ChartLine[];
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
            Kaiji is still {formatElo(snap.kaijiElo)}, the same chair as the rest of the room. Deal at least one full match and the Elo lines will move. Those lines are table Elo: Kaiji&apos;s gains come out of the chairs that paid them, instead of vanishing into a bench average. A rated match is 240 hands. If the hand total cuts a match short, that match is not rated.
          </p>
        </section>
      ) : (
        <>
          <section className="rounded-xl border bg-card p-4">
            <h3 className="text-base">Kaiji against the teams</h3>
            <p className="mb-2 text-xs text-muted-foreground">
              Kaiji is one rating, so his result shows up in full. Each other line starts at 1,500 and stacks every point that team&apos;s seated players won or lost. A gain on Kaiji&apos;s line is a loss on theirs. Averaging the bench hid those losses, because hundreds of bots barely move.
            </p>
            <LineChart points={snap.history} lines={teamLines} empty="" />
          </section>
          <section className="rounded-xl border bg-card p-4">
            <h3 className="text-base">Kaiji against the four tiers</h3>
            <p className="mb-2 text-xs text-muted-foreground">
              Same stacking by style. Two GTO seats in one match both land on the GTO line. Across a match the Elo changes still sum to zero. The bench average of bots who have sat stays near the start: GTO {formatElo(snap.benchTiers.gto)}, dynamic {formatElo(snap.benchTiers.dynamic)}, frozen {formatElo(snap.benchTiers.frozen)}, adapters {formatElo(snap.benchTiers.agentic)}.
            </p>
            <LineChart points={snap.history} lines={tierLines} empty="" />
          </section>
          <section className="rounded-xl border bg-card p-4">
            <h3 className="text-base">Cumulative chips</h3>
            <p className="mb-2 text-xs text-muted-foreground">
              Chips are the slide&apos;s score: end stack minus 10,000, summed over hands. Tier lines add every seated bot of that tier, so they cover five seats most matches and swing harder than Kaiji.
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
                    <th className="py-1 pr-3 font-medium">Table Elo</th>
                    <th className="py-1 pr-3 font-medium">Versus Kaiji</th>
                    <th className="py-1 font-medium">Chips</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t">
                    <td className="py-2 pr-3">Kaiji</td>
                    <td className="py-2 pr-3 tabular-nums">{formatElo(snap.kaijiElo)}</td>
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
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {snap.teamNames.map((name, index) => (
            <p key={name} className="text-sm">
              <span className="text-muted-foreground">{name}.</span> {formatElo(snap.teamElos[index] ?? INITIAL_ELO)}
            </p>
          ))}
        </div>
      </section>

      <section className="rounded-xl border bg-card p-4">
        <h3 className="text-base">The field</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {snap.botCount.toLocaleString("en-US")} variants. GTO {snap.tierCounts.gto.toLocaleString("en-US")}, dynamic {snap.tierCounts.dynamic.toLocaleString("en-US")}, frozen {snap.tierCounts.frozen.toLocaleString("en-US")}, adapters {snap.tierCounts.agentic.toLocaleString("en-US")}. Frozen personalities were fixed when the seed was created. Adapters only rewrite their own thresholds from hands they sat.
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
                  {hit.team} · {TIER_LABEL[hit.tier]} · Elo {formatElo(hit.elo)} · {hit.matches} rated
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
          Seven teams by default. Team 1 is only Kaiji. The other teams split at least a thousand generated variants, and each of those teams holds all four tiers: a fast GTO-style chart, dynamic bots whose tightness and aggression move with their Elo and the table&apos;s Elo, frozen personalities fixed at creation, and adapters that rewrite thresholds from showdown rate, fold-to-shove, and aggression they actually saw. Each match seats six of the teams and rotates who sits out. A non-Kaiji seat draws one variant for the whole match. Heads-up is a side game and does not touch these ratings. Ratings stay in localStorage.
        </p>
      </section>
      <section className="rounded-xl border bg-card p-4">
        <h2 className="text-base">The deadline</h2>
        <p className="mt-2 text-muted-foreground">
          Poker on the slides is a forced match every 10 minutes. The default stop is the full window from 5 Oct 2026 00:00 UTC through the 23:50 UTC match on 11 Oct 2026: 1,008 matches. Each match is 240 hands, so that window is 241,920 hands. The hand total is the match count times 240 and rewrites itself when the match count changes. Whichever limit arrives first locks Kaiji&apos;s Elo. A match cut off before 240 hands is not rated. Kaiji&apos;s Elo on the lock is the last rated value.
        </p>
      </section>
    </article>
  );
}
