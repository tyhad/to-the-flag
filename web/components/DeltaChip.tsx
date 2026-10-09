import { formatDelta } from "../viewModel/tower";

const TONES = {
  up: "text-green",
  down: "text-red",
  none: "text-text-3",
} as const;

/** Places gained or lost against the table without locks. The arrow and number carry the meaning, not the color. */
export function DeltaChip({ rankChange }: { rankChange: number }) {
  const delta = formatDelta(rankChange);
  return (
    <span className={`type-data inline-flex h-6 min-w-14 items-center justify-center rounded-control bg-s2 px-2 ${TONES[delta.tone]}`}>
      <span aria-hidden="true">{delta.text}</span>
      <span className="sr-only">{delta.description}</span>
    </span>
  );
}
