export function ScenarioStrip() {
  return (
    <footer aria-label="Scenarios" className="col-span-3 flex min-h-14 items-center gap-3 rounded-panel bg-s1 px-4 py-2">
      <span className="type-label rounded-control border border-accent bg-s2 px-3 py-2 text-text">Base</span>
      <p className="type-body text-text-2">No saved scenarios yet. Lock a result, then save the scenario to compare it later.</p>
    </footer>
  );
}
