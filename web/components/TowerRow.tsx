import { useTweenedNumber } from "../motion";
import { teamColor } from "../theme/teams";
import { formatPoints, statusTag, type TowerRow as Row } from "../viewModel/tower";
import { DeltaChip } from "./DeltaChip";
import { StatusTag } from "./StatusTag";

/** Column order: position, name, points, change, status. Numerals sit right-aligned in their columns. */
export const TOWER_COLUMNS = "grid-cols-[2rem_minmax(0,1fr)_7rem_3.5rem_6rem]";

export function TowerRow({ row }: { row: Row }) {
  const tween = useTweenedNumber(row.points);
  const projected = tween === row.points ? row.points : Math.round(tween);
  const changed = row.pointsAdded !== 0;
  const tag = statusTag(row);

  // Eliminated: text-3 and line-through. Not racing: text-3 only.
  const textTone = row.eliminated ? "text-text-3 line-through" : row.inactive ? "text-text-3" : "text-text";

  return (
    <li
      data-flip-id={row.id}
      className={`relative grid h-10 items-center gap-3 border-b border-line pl-4 pr-3 ${TOWER_COLUMNS}`}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ backgroundColor: teamColor(row.teamId) }}
      />
      <span className="type-data text-right text-text-2">
        <span className="sr-only">Position </span>
        {row.rank}
      </span>
      <span className={`type-title truncate ${textTone}`} title={row.name}>
        {row.label}
      </span>
      <span className="type-data grid grid-cols-[3rem_1rem_3rem] items-center text-right">
        {changed ? (
          <>
            <span className="text-text-3" aria-hidden="true">
              {formatPoints(row.basePoints)}
            </span>
            <span className="text-center text-text-3" aria-hidden="true">
              →
            </span>
            <span className={textTone} aria-hidden="true">
              {formatPoints(projected)}
            </span>
            <span className="sr-only">
              {formatPoints(row.basePoints)} points now, {formatPoints(row.points)} with locked results
            </span>
          </>
        ) : (
          <>
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            <span className={textTone}>
              {formatPoints(projected)}
              <span className="sr-only"> points</span>
            </span>
          </>
        )}
      </span>
      <span className="justify-self-center">
        <DeltaChip rankChange={row.rankChange} />
      </span>
      <span className="justify-self-start">{tag ? <StatusTag view={tag} /> : null}</span>
    </li>
  );
}
