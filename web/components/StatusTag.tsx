import type { StatusTagView } from "../viewModel/tower";
import { CrossIcon } from "./icons";

// Filled tags use s0 text. No title and "not racing" have no fill and use text-3 (DESIGN.md section 6).
const TONES: Record<StatusTagView["tone"], string> = {
  clinched: "chamfer bg-purple text-s0",
  alive: "chamfer bg-green text-s0",
  longShot: "chamfer bg-yellow text-s0",
  eliminated: "text-text-3",
  inactive: "text-text-3",
};

export function StatusTag({ view }: { view: StatusTagView }) {
  // The label stays visible; when the tag has an accessible name, screen readers get that instead of the label.
  const text = view.accessibleName ? (
    <>
      <span aria-hidden="true">{view.label}</span>
      <span className="sr-only">{view.accessibleName}</span>
    </>
  ) : (
    view.label
  );
  const tag = (
    <span className={`type-label inline-flex h-6 items-center gap-1 px-2 ${TONES[view.tone]}`}>
      {view.icon === "cross" ? <CrossIcon /> : null}
      {text}
    </span>
  );
  // The glow sits on a wrapper because clip-path would cut it off the tag itself.
  return view.tone === "clinched" ? <span className="inline-flex shadow-clinched">{tag}</span> : tag;
}