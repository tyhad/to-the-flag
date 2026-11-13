import { useRef, type KeyboardEvent } from "react";
import {
  TITLE_INFO_LABEL,
  TITLE_INFO_MODES,
  TITLE_INFO_OPTION_HINTS,
  TITLE_INFO_OPTION_LABELS,
  nextTitleInfo,
  type TitleInfoMode,
} from "../viewModel/titleInfo";

const LABEL_ID = "title-info-label";

/**
 * "Title info: Auto / On / Off". A three-way radio group: Tab reaches the selected option, the arrow keys, Home and
 * End move between the options. The focus ring is the global one (DESIGN.md section 5); it is never removed here.
 */
export function TitleInfoSwitch({ mode, onChange }: { mode: TitleInfoMode; onChange: (mode: TitleInfoMode) => void }) {
  const refs = useRef(new Map<TitleInfoMode, HTMLButtonElement>());

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, from: TitleInfoMode) {
    const next = nextTitleInfo(from, event.key);
    if (!next) return;
    event.preventDefault();
    onChange(next);
    refs.current.get(next)?.focus();
  }

  return (
    <div className="flex items-center gap-3">
      <span id={LABEL_ID} className="type-label text-text-2">
        {TITLE_INFO_LABEL}
      </span>
      <div role="radiogroup" aria-labelledby={LABEL_ID} className="flex gap-1">
        {TITLE_INFO_MODES.map((option) => {
          const selected = option === mode;
          const look = selected
            ? "border-accent bg-s2 text-text"
            : "border-transparent text-text-2 hover:border-accent-hover";
          return (
            <button
              key={option}
              ref={(node) => {
                if (node) refs.current.set(option, node);
                else refs.current.delete(option);
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              title={TITLE_INFO_OPTION_HINTS[option]}
              onClick={() => onChange(option)}
              onKeyDown={(event) => onKeyDown(event, option)}
              className={`type-label h-8 rounded-control border px-3 ${look}`}
            >
              {TITLE_INFO_OPTION_LABELS[option]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
