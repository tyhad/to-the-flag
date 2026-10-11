import type { ReactNode } from "react";

interface EmptyStateProps {
  /** Say what to do, in plain words (DESIGN.md section 8). */
  title: string;
  children?: ReactNode;
  /** A button that fixes the problem, for example "Try again". */
  action?: ReactNode;
}

export function EmptyState({ title, children, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col gap-1 rounded-control border border-dashed border-line p-4">
      <p className="type-title text-text">{title}</p>
      {children ? <p className="type-body text-text-2">{children}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
