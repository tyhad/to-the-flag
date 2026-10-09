import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/** DESIGN.md section 7: rows swap in about 250 ms, numbers tween in about 300 ms. */
export const SWAP_MS = 250;
export const TWEEN_MS = 300;

/** Read at the moment an animation would start, so a changed OS setting applies at once. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * FLIP row swap. Give each row `data-flip-id`. After every render, rows whose position changed
 * slide from their old place to the new one. A row seen for the first time does not animate,
 * and nothing animates with reduced motion.
 */
export function useFlip(listRef: RefObject<HTMLElement | null>): void {
  const previous = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const rows = Array.from(list.querySelectorAll<HTMLElement>("[data-flip-id]"));
    const next = new Map<string, number>();
    for (const row of rows) next.set(row.dataset.flipId ?? "", row.offsetTop);

    if (!prefersReducedMotion()) {
      for (const row of rows) {
        const id = row.dataset.flipId ?? "";
        const before = previous.current.get(id);
        const after = next.get(id);
        if (before === undefined || after === undefined || before === after) continue;
        row.animate([{ transform: `translateY(${before - after}px)` }, { transform: "translateY(0)" }], {
          duration: SWAP_MS,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
        });
      }
    }
    previous.current = next;
  });
}

/**
 * The number to draw while `target` changes: it eases from the value on screen to the new one.
 * Intermediate values are whole numbers; the last frame is exactly `target` (half points included).
 */
export function useTweenedNumber(target: number, duration: number = TWEEN_MS): number {
  const [shown, setShown] = useState(target);
  const current = useRef(target);

  useEffect(() => {
    if (current.current === target) return;
    if (prefersReducedMotion() || duration <= 0) {
      current.current = target;
      setShown(target);
      return;
    }
    const from = current.current;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const value = t === 1 ? target : Math.round(from + (target - from) * (1 - (1 - t) ** 3));
      current.current = value;
      setShown(value);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return shown;
}
