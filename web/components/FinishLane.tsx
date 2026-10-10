import { useId, useMemo, useRef } from "react";
import type { Scenario, SeasonState } from "../../engine";
import { useTweenedNumber, useFlip } from "../motion";
import { teamColor } from "../theme/teams";
import { useElementWidth } from "../useElementWidth";
import { axisTicks, buildLaneView, laneX, type LaneModel, type LaneRowView } from "../viewModel/lane";
import { formatPoints } from "../viewModel/tower";

/** Width of the label column (6rem) and the room kept free at each end of the track. */
const LABEL_W = 96;
const PAD_L = 8;
const PAD_R = 14;
/** A multiple of the 8px chequer cell, so the line stays unbroken from one lane to the next. */
const ROW_H = 32;
const CELL = 8;

interface LaneRowProps {
  row: LaneRowView;
  model: LaneModel;
  trackW: number;
  chequerId: string;
}

function LaneRow({ row, model, trackW, chequerId }: LaneRowProps) {
  const projected = useTweenedNumber(row.projected);
  const ceiling = useTweenedNumber(row.ceiling);
  const x = (value: number) => laneX(value, model, trackW, PAD_L, PAD_R);
  const xBase = x(row.base);
  const xProjected = x(projected);
  const xCeiling = x(ceiling);
  const xLine = x(model.finishAt);
  const mid = ROW_H / 2;
  // Whole chequer cells only, centered on the finish total.
  const lineX = Math.round((xLine - CELL / 2) / CELL) * CELL;

  return (
    <div
      data-flip-id={row.driver}
      tabIndex={0}
      role="img"
      aria-label={row.summary}
      className="grid grid-cols-[6rem_minmax(0,1fr)] items-center"
      style={{ height: ROW_H }}
    >
      <div className="relative flex h-full items-center justify-between pl-3 pr-2">
        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: teamColor(row.teamId) }} />
        <span className="type-title text-text" aria-hidden="true">
          {row.driver}
        </span>
        <span className="type-data text-text-2" aria-hidden="true">
          {formatPoints(projected)}
        </span>
      </div>
      <svg width={trackW} height={ROW_H} viewBox={`0 0 ${trackW} ${ROW_H}`} aria-hidden="true" className="block">
        <line x1={PAD_L} x2={trackW - PAD_R} y1={mid} y2={mid} className="stroke-line" strokeWidth={2} strokeLinecap="round" />
        {xProjected > xBase ? (
          <rect x={xBase} y={mid - 3} width={xProjected - xBase} height={6} rx={3} className="fill-accent" />
        ) : null}
        {xCeiling > xProjected ? (
          <>
            <line x1={xProjected} x2={xCeiling} y1={mid} y2={mid} className="stroke-text-3" strokeWidth={1.5} />
            <line x1={xCeiling} x2={xCeiling} y1={mid - 6} y2={mid + 6} className="stroke-text-3" strokeWidth={1.5} />
          </>
        ) : null}
        <rect x={lineX} y={0} width={CELL} height={ROW_H} fill={`url(#${chequerId})`} />
        <circle cx={xProjected} cy={mid} r={5} fill={teamColor(row.teamId)} className="stroke-s1" strokeWidth={2} />
      </svg>
    </div>
  );
}

interface FinishLaneProps {
  state: SeasonState;
  scenario?: Scenario;
  /** The drivers to draw, one lane each. */
  contenders: readonly string[];
}

/**
 * The signature graphic: gap to the line. One lane per contender; the dot is the projected total, the
 * sage bar what the locks added, the thin line the most they can reach, the chequered line the total at
 * which the leader clinches. Drawn in SVG from tokens only.
 */
export function FinishLane({ state, scenario, contenders }: FinishLaneProps) {
  const view = useMemo(() => buildLaneView(state, scenario, contenders), [state, scenario, contenders]);
  const sectionRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(sectionRef, 560);
  const chequerId = `chequer-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  useFlip(listRef);

  if (view.rows.length === 0) return null;

  const { model } = view;
  const trackW = Math.max(160, width - LABEL_W);
  const x = (value: number) => laneX(value, model, trackW, PAD_L, PAD_R);
  const xLine = x(model.finishAt);
  const nearRight = xLine > trackW - 120;

  return (
    <section
      ref={sectionRef}
      aria-labelledby="lane-title"
      className="flex shrink-0 flex-col gap-2 border-t border-line pt-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 id="lane-title" className="type-title text-text">
          Finish lane
        </h3>
        <p className="type-caption text-text-2">{view.caption}</p>
      </div>

      {/* The chequered pattern, defined once and used by every lane. */}
      <svg width={0} height={0} aria-hidden="true" className="absolute">
        <defs>
          <pattern id={chequerId} width={CELL} height={CELL} patternUnits="userSpaceOnUse">
            <rect width={CELL} height={CELL} className="fill-s2" />
            <rect width={CELL / 2} height={CELL / 2} className="fill-text" />
            <rect x={CELL / 2} y={CELL / 2} width={CELL / 2} height={CELL / 2} className="fill-text" />
          </pattern>
        </defs>
      </svg>

      <div className="grid grid-cols-[6rem_minmax(0,1fr)]" aria-hidden="true">
        <span />
        <svg width={trackW} height={18} viewBox={`0 0 ${trackW} 18`} className="block">
          <text
            x={nearRight ? xLine - 8 : xLine + 8}
            y={13}
            textAnchor={nearRight ? "end" : "start"}
            className="type-caption fill-text-2"
          >
            Clinch at {formatPoints(model.finishAt)}
          </text>
        </svg>
      </div>

      <div ref={listRef} className="relative flex flex-col" aria-label="Contenders, gap to the finish line">
        {view.rows.map((row) => (
          <LaneRow key={row.driver} row={row} model={model} trackW={trackW} chequerId={chequerId} />
        ))}
      </div>

      <div className="grid grid-cols-[6rem_minmax(0,1fr)]" aria-hidden="true">
        <span />
        <svg width={trackW} height={22} viewBox={`0 0 ${trackW} 22`} className="block">
          {axisTicks(model.axisMin, model.axisMax).map((tick) => (
            <g key={tick}>
              <line x1={x(tick)} x2={x(tick)} y1={0} y2={5} className="stroke-line" strokeWidth={1.5} />
              <text x={x(tick)} y={18} textAnchor="middle" className="type-caption fill-text-3">
                {tick}
              </text>
            </g>
          ))}
        </svg>
      </div>

      <p className="type-caption text-text-3 [@media(max-height:800px)]:hidden">
        Dot: projected points. Sage bar: added by your locks. Thin line: the most they can reach. Chequered line: where the leader clinches.
      </p>
    </section>
  );
}
