"use client";

import { useEffect, useState } from "react";
import { jevReady } from "@/lib/jev";

export function JevStatus() {
  const [ready, setReady] = useState<boolean | null>(null);

  useEffect(() => {
    let cancel = false;
    void jevReady().then((ok) => {
      if (!cancel) setReady(ok);
    });
    return () => {
      cancel = true;
    };
  }, []);

  if (ready === null) {
    return <p className="mt-2 text-xs text-muted-foreground">Checking whether Jev is on this computer.</p>;
  }
  return (
    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
      {ready
        ? "Jev can play from this computer. The key stays on the machine and is never sent to the page."
        : "Jev is off here. The published page does not keep a key, so this seat checks or folds until the table is running on your computer."}
    </p>
  );
}
