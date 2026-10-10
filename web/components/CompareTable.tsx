import { teamColor } from "../theme/teams";
import {
  describeCompareRow,
  formatPointsDiff,
  summarizeCompare,
  type CompareRow,
} from "../viewModel/compare";
import { formatPoints, type TowerTab } from "../viewModel/tower";
import { DeltaChip } from "./DeltaChip";

interface CompareTableProps {
  rows: readonly CompareRow[];
  leftLabel: string;
  rightLabel: string;
  tab: TowerTab;
}

const DIFF_TONE = (diff: number) => (diff > 0 ? "text-green" : diff < 0 ? "text-red" : "text-text-3");

/**
 * Two scenarios side by side. A row that differs is marked by a place arrow with a number, a signed
 * points figure and a lighter row background: never by color alone.
 */
export function CompareTable({ rows, leftLabel, rightLabel, tab }: CompareTableProps) {
  return (
    <div className="flex flex-col gap-3">
      <p className="type-body text-text-2" role="status">
        {summarizeCompare(rows, tab)}
      </p>
      <table className="w-full table-fixed border-collapse">
        <caption className="sr-only">
          {leftLabel} compared with {rightLabel}
        </caption>
        <colgroup>
          <col className="w-[3px]" />
          <col />
          <col className="w-28" />
          <col className="w-28" />
          <col className="w-36" />
        </colgroup>
        <thead>
          <tr className="type-label text-text-2">
            <th scope="col" colSpan={2} className="pb-2 pl-3 text-left font-semibold">
              {tab === "wdc" ? "Driver" : "Constructor"}
            </th>
            <th scope="col" className="pb-2 pr-3 text-right font-semibold">
              <span className="block truncate" title={leftLabel}>
                {leftLabel}
              </span>
            </th>
            <th scope="col" className="pb-2 pr-3 text-right font-semibold">
              <span className="block truncate" title={rightLabel}>
                {rightLabel}
              </span>
            </th>
            <th scope="col" className="pb-2 pr-3 text-right font-semibold">
              Change
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const dim = row.inactive ? "text-text-3" : "text-text";
            return (
              <tr key={row.id} className={`h-10 border-b border-line ${row.differs ? "bg-s2" : ""}`}>
                <td className="w-[3px] p-0" aria-hidden="true" style={{ backgroundColor: teamColor(row.teamId) }} />
                <th scope="row" className={`type-title pl-3 text-left font-semibold ${dim}`} title={row.name}>
                  <span className="block truncate">{row.label}</span>
                </th>
                <td className="type-data pr-3 text-right">
                  <span className="text-text-3">P{row.leftRank}</span> <span className={dim}>{formatPoints(row.leftPoints)}</span>
                </td>
                <td className="type-data pr-3 text-right">
                  <span className="text-text-3">P{row.rightRank}</span> <span className={dim}>{formatPoints(row.rightPoints)}</span>
                </td>
                <td className="pr-3 text-right">
                  {row.differs ? (
                    <span className="inline-flex items-center justify-end gap-2">
                      <span aria-hidden="true" className="inline-flex items-center gap-2">
                        <DeltaChip rankChange={row.rankChange} />
                        <span className={`type-data min-w-12 ${DIFF_TONE(row.pointsDiff)}`}>{formatPointsDiff(row.pointsDiff)}</span>
                      </span>
                      <span className="sr-only">{describeCompareRow(row)}</span>
                    </span>
                  ) : (
                    <span className="type-caption text-text-3">No change</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
