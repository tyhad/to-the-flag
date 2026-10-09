import { EmptyState } from "./EmptyState";

export function SessionsRail() {
  return (
    <aside aria-labelledby="sessions-title" className="flex min-h-0 flex-col gap-3 overflow-y-auto rounded-panel bg-s1 p-4">
      <h2 id="sessions-title" className="type-title text-text">
        Sessions
      </h2>
      <EmptyState title="No sessions to set yet">Remaining races and sprints appear here. Lock a result to set it.</EmptyState>
    </aside>
  );
}
