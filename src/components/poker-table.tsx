"use client";

import { PlayingCard } from "@/components/cards";
import { seatSpot, turnText, type TableView } from "@/lib/table-view";

export function PokerTable({
  view,
  onSit,
  onVacate,
}: {
  view: TableView;
  onSit?: (seat: number) => void;
  onVacate?: (seat: number) => void;
}) {
  const turn = turnText(view);
  return (
    <div className="table-scene" data-testid="poker-table">
      <div className="table-floor" />
      <div className="table-felt" />
      <div className="table-center">
        <p className={`table-turn ${view.actor === view.yourSeat && view.phase === "act" ? "mine" : ""}`} data-turn-label aria-live="polite">
          {turn}
        </p>
        <p className="text-[10px] uppercase tracking-[0.22em] text-[#e2b657]">{view.streetLabel}</p>
        <p className="text-sm text-[#f6efe2]">Pot {view.pot.toLocaleString("en-US")}</p>
        <div className="mt-1 flex min-h-12 items-center justify-center gap-1">
          {view.board.length === 0 ? <span className="text-[11px] text-[#d5c7ae]">Board not dealt</span> : null}
          {view.board.map((card) => (
            <PlayingCard key={card} card={card} small />
          ))}
        </div>
        {view.lastAction ? <p className="mt-1 max-w-[14rem] text-center text-xs text-[#f6efe2]">{view.lastAction}</p> : null}
      </div>
      {view.seats.map((seat, index) => {
        const spot = seatSpot(index, view.yourSeat);
        const acting = view.phase === "act" && view.actor === index;
        const dealer = view.phase !== "lobby" && view.button === index;
        const cardsAbove = spot.y >= 50;
        const body = (
          <>
            {cardsAbove ? <SeatCards seat={seat} yours={seat.isYou} /> : null}
            <div className="table-cushion" />
            <div className={`table-avatar ${seat.empty ? "empty" : ""} ${seat.human ? "human" : ""}`}>
              {seat.empty ? "+" : seat.name.slice(0, 2)}
              {dealer ? <span className="table-dealer">D</span> : null}
            </div>
            {!cardsAbove ? <SeatCards seat={seat} yours={seat.isYou} /> : null}
            <p className="table-name">{seat.name}</p>
            <p className="table-detail">
              {seat.empty ? "Open" : seat.detail}
              {!seat.empty && seat.stack ? ` · ${seat.stack.toLocaleString("en-US")}` : ""}
              {seat.folded ? " · Folded" : seat.allin ? " · All-in" : ""}
            </p>
            {acting ? <p className="table-flag">Turn</p> : null}
          </>
        );
        const className = `table-seat ${acting ? "turn" : ""} ${seat.folded ? "folded" : ""} ${seat.isYou ? "you" : ""} ${spot.slot === 0 ? "near" : ""}`;
        const style = { left: `${spot.x}%`, top: `${spot.y}%` };
        const vacate = Boolean(onVacate && !seat.empty && !seat.human && !seat.isYou);
        const claim = Boolean(seat.empty && onSit);
        if (claim || vacate) {
          const press = () => (claim ? onSit?.(index) : onVacate?.(index));
          return (
            <div
              key={index}
              role="button"
              tabIndex={0}
              data-seat={index}
              data-open={claim ? "true" : "ai"}
              aria-label={claim ? `Sit in ${seat.name}` : `Free ${seat.name}'s chair`}
              className={className}
              style={style}
              onClick={press}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  press();
                }
              }}
            >
              {body}
            </div>
          );
        }
        return (
          <div key={index} data-seat={index} className={className} style={style}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

function SeatCards({
  seat,
  yours,
}: {
  seat: TableView["seats"][number];
  yours: boolean;
}) {
  if (seat.empty) return <div className="h-8" />;
  if (seat.cards === "muck") return <p className="text-[10px] text-[#d5c7ae]">Mucked</p>;
  const faces = seat.cards === "back" ? [null, null] : seat.cards;
  return (
    <div className="flex justify-center gap-0.5" {...(yours ? { "data-your-cards": true } : {})}>
      {faces.map((card, index) => (
        <PlayingCard key={card ?? `back-${index}`} card={card} small={!yours} />
      ))}
    </div>
  );
}
