/**
 * Small inline icons. Always paired with text, never the only signal, except on a button that has its own
 * aria-label (the Up and Down arrows of the starting grid editor).
 */

export function AlertIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
    >
      <path d="M8 2 14.5 13.5h-13z" />
      <path d="M8 6.5v3.2M8 11.6v.4" />
    </svg>
  );
}

export function ClockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" />
    </svg>
  );
}

/** The cross of the `✕ No title` tag. Always sits next to the text. */
export function CrossIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5" />
    </svg>
  );
}

/** An arrow pointing up, for a button named "Move X up". */
export function ArrowUpIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
    </svg>
  );
}

/** An arrow pointing down, for a button named "Move X down". */
export function ArrowDownIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3v10M3.5 8.5 8 13l4.5-4.5" />
    </svg>
  );
}
