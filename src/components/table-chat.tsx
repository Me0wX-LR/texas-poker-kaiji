"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cleanChatText } from "@/lib/table-view";

export interface ChatLine {
  id: string;
  name: string;
  text: string;
}

export function TableChat({
  lines,
  onSend,
}: {
  lines: ChatLine[];
  onSend: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lines]);

  function submit() {
    const text = cleanChatText(draft);
    if (!text) return;
    onSend(text);
    setDraft("");
  }

  return (
    <div data-testid="table-chat" className="flex min-h-0 flex-col gap-2">
      <div ref={scroller} className="max-h-[min(16rem,40dvh)] min-h-24 overflow-auto rounded-lg border border-[#3a3a3a] bg-[#101010] p-2">
        {lines.length === 0 ? (
          <p className="text-sm text-[#b7b0a4]">The table is quiet. Say who you are betting.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {lines.map((line) => (
              <li key={line.id} className="text-sm leading-snug">
                <span className="text-[#ff6b6b]">{line.name}</span>
                <span className="text-[#f4efe6]"> {line.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <input
          value={draft}
          maxLength={160}
          enterKeyHint="send"
          aria-label="Message the table"
          placeholder="Message the table"
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-input bg-[#161616] px-2.5 text-base text-[#f4efe6] outline-none"
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button type="submit" className="min-h-11 shrink-0">
          Send
        </Button>
      </form>
    </div>
  );
}
