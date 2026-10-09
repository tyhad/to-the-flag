import { useRef } from "react";
import { useFlip } from "../motion";
import type { TowerRow as Row } from "../viewModel/tower";
import { TowerRow } from "./TowerRow";

export function Tower({ rows, label }: { rows: readonly Row[]; label: string }) {
  const listRef = useRef<HTMLOListElement>(null);
  useFlip(listRef);

  return (
    <ol ref={listRef} aria-label={label} className="relative m-0 list-none border-t border-line p-0">
      {rows.map((row) => (
        <TowerRow key={row.id} row={row} />
      ))}
    </ol>
  );
}
