import { useRef, type KeyboardEvent } from "react";

export interface TabItem<T extends string> {
  id: T;
  label: string;
  disabled?: boolean;
  /** Short explanation shown as a tooltip, for example why a tab is disabled. */
  hint?: string;
}

interface TabsProps<T extends string> {
  /** Accessible name of the tab group. */
  label: string;
  /** Prefix for the generated ids that link each tab to its panel. */
  idPrefix: string;
  items: readonly TabItem<T>[];
  selected: T;
  onSelect: (id: T) => void;
}

export function tabId(idPrefix: string, id: string): string {
  return `${idPrefix}-tab-${id}`;
}

export function panelId(idPrefix: string, id: string): string {
  return `${idPrefix}-panel-${id}`;
}

/** Accessible tab group: arrow keys, Home and End move between enabled tabs. */
export function Tabs<T extends string>({ label, idPrefix, items, selected, onSelect }: TabsProps<T>) {
  const refs = useRef(new Map<T, HTMLButtonElement>());

  function move(from: T, key: string) {
    const enabled = items.filter((item) => !item.disabled);
    const index = enabled.findIndex((item) => item.id === from);
    let next: TabItem<T> | undefined;
    if (key === "ArrowRight") next = enabled[(index + 1) % enabled.length];
    else if (key === "ArrowLeft") next = enabled[(index - 1 + enabled.length) % enabled.length];
    else if (key === "Home") next = enabled[0];
    else if (key === "End") next = enabled[enabled.length - 1];
    if (!next) return;
    onSelect(next.id);
    refs.current.get(next.id)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, id: T) {
    if (["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      move(id, event.key);
    }
  }

  return (
    <div role="tablist" aria-label={label} className="flex gap-2">
      {items.map((item) => {
        const isSelected = item.id === selected;
        const state = item.disabled
          ? "cursor-not-allowed border-line text-text-3"
          : isSelected
            ? "border-accent bg-s2 text-text"
            : "border-transparent text-text-2 hover:border-accent-hover";
        return (
          <button
            key={item.id}
            ref={(node) => {
              if (node) refs.current.set(item.id, node);
              else refs.current.delete(item.id);
            }}
            type="button"
            role="tab"
            id={tabId(idPrefix, item.id)}
            aria-selected={isSelected}
            aria-controls={item.disabled ? undefined : panelId(idPrefix, item.id)}
            aria-disabled={item.disabled || undefined}
            title={item.hint}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => {
              if (!item.disabled) onSelect(item.id);
            }}
            onKeyDown={(event) => onKeyDown(event, item.id)}
            className={`type-label h-9 rounded-control border px-3 ${state}`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
