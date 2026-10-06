import { cardText } from "@/lib/eval";

export function PlayingCard({
  card,
  small = false,
}: {
  card: number | null;
  small?: boolean;
}) {
  if (card === null) {
    return <div className={small ? "card-back small" : "card-back"} aria-hidden="true" />;
  }
  const face = cardText(card);
  return (
    <div className={`card-face ${face.red ? "red" : ""} ${small ? "small" : ""}`}>
      <span>{face.rank}</span>
      <span>{face.suit}</span>
    </div>
  );
}
