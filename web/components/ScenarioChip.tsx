import type { ScenarioChip as Chip } from "../viewModel/scenarios";

function ClockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 2 14.5 13.5h-13z" />
      <path d="M8 6.5v3.2M8 11.6v.4" />
    </svg>
  );
}

interface ScenarioChipProps {
  chip: Chip;
  onSelect: (id: string | null) => void;
}

/** Every state is said in words and shown with an icon: stale, invalid and live are never color alone. */
export function ScenarioChip({ chip, onSelect }: ScenarioChipProps) {
  const tone = chip.selected
    ? "border-accent bg-s2 text-text"
    : "border-line text-text-2 hover:border-accent-hover";
  return (
    <button
      type="button"
      aria-pressed={chip.selected}
      title={chip.note ?? undefined}
      onClick={() => onSelect(chip.id)}
      className={`type-label inline-flex h-9 items-center gap-2 rounded-control border px-3 ${tone}`}
    >
      <span>{chip.name}</span>
      {chip.live ? (
        <span className="inline-flex items-center gap-1 text-accent-text">
          <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-accent-text" />
          Live
          <span className="sr-only"> on the overlay</span>
        </span>
      ) : null}
      {chip.stale ? (
        <span className="inline-flex items-center gap-1 text-text-3">
          <ClockIcon />
          {chip.staleLabel}
          <span className="sr-only"> (older data)</span>
        </span>
      ) : null}
      {!chip.valid ? (
        <span className="inline-flex items-center gap-1 text-yellow">
          <AlertIcon />
          Invalid
        </span>
      ) : null}
    </button>
  );
}

export { AlertIcon };
