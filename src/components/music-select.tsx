"use client";

import { MUSIC_TRACKS, musicName } from "@/lib/table-music";

export function MusicSelect({
  id = "table-music",
  value,
  onChange,
  disabled = false,
}: {
  id?: string;
  value: string;
  onChange?: (id: string) => void;
  disabled?: boolean;
}) {
  const playing = musicName(value);
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground" htmlFor={id}>
      Music
      <select
        id={id}
        data-testid="music-select"
        className="min-h-11 w-full rounded-lg border border-input bg-[#161616] px-2 text-base text-[#f4efe6]"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.value)}
      >
        {MUSIC_TRACKS.map((track) => (
          <option key={track.id} value={track.id}>
            {track.style === "Castle" ? `${track.name} · Castle` : track.name}
          </option>
        ))}
      </select>
      {disabled ? <span>The host picks the room music. Now playing {playing}.</span> : null}
    </label>
  );
}
