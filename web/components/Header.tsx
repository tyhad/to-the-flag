import { headerLabel, type HealthState } from "../viewModel/health";

export function Header({ health }: { health: HealthState }) {
  return (
    <header className="col-span-3 flex h-14 items-center justify-between rounded-panel bg-s1 px-4">
      <h1 className="type-heading text-text">To the Flag</h1>
      <p className="type-label text-text-2" aria-live="polite">
        {headerLabel(health)}
      </p>
    </header>
  );
}
