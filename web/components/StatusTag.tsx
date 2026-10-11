import type { StatusTagView } from "../viewModel/tower";

// Filled tags use s0 text. Eliminated and "not racing" have no fill and use text-3 (DESIGN.md section 6).
const TONES: Record<StatusTagView["tone"], string> = {
  clinched: "chamfer bg-purple text-s0",
  alive: "chamfer bg-green text-s0",
  longShot: "chamfer bg-yellow text-s0",
  eliminated: "text-text-3",
  inactive: "text-text-3",
};

export function StatusTag({ view }: { view: StatusTagView }) {
  const tag = (
    <span className={`type-label inline-flex h-6 items-center px-2 ${TONES[view.tone]}`}>{view.label}</span>
  );
  // The glow sits on a wrapper because clip-path would cut it off the tag itself.
  return view.tone === "clinched" ? <span className="inline-flex shadow-clinched">{tag}</span> : tag;
}
