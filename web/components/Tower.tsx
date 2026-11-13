import { useRef } from "react";
import { useFlip } from "../motion";
import { BEST_COLUMN_LABEL, BEST_HINT, type TowerRow as Row } from "../viewModel/tower";
import { TowerRow, towerColumnsClass } from "./TowerRow";

interface TowerProps {
  rows: readonly Row[];
  label: string;
  /** Draw the Best column and the status tags. Off (or Auto while nobody is out) is a plain standings table. */
  showTitleInfo?: boolean;
}

export function Tower({ rows, label, showTitleInfo = true }: TowerProps) {
  const listRef = useRef<HTMLOListElement>(null);
  useFlip(listRef);

  return (
    <div>
      {showTitleInfo ? (
        // Column header for the eye only: every Best cell carries its own accessible name.
        <div aria-hidden="true" className={`grid h-6 items-center gap-3 pl-4 pr-3 ${towerColumnsClass(true)}`}>
          <span className="type-caption col-start-5 text-center text-text-3">{BEST_COLUMN_LABEL}</span>
        </div>
      ) : null}
      <ol ref={listRef} aria-label={label} className="relative m-0 list-none border-t border-line p-0">
        {rows.map((row) => (
          <TowerRow key={row.id} row={row} showTitleInfo={showTitleInfo} />
        ))}
      </ol>
      {showTitleInfo ? <p className="type-caption mt-2 text-text-3">{BEST_HINT}</p> : null}
    </div>
  );
}