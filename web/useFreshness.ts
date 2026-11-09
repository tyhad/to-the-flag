import { useEffect, useState } from "react";
import {
  decideFreshness,
  type FreshnessBaseline,
  type FreshnessCheck,
  type FreshnessResult,
} from "./viewModel/freshness";

export interface UseFreshnessOptions {
  baseline: FreshnessBaseline | null | undefined;
  isEditing?: boolean;
  pollIntervalMs?: number;
}

/**
 * Polls `/api/health` every 60 seconds while the tab is visible (and once when it becomes visible again).
 * Compares checkedAt and asOfRound with the page's baseline.
 * Never reloads automatically.
 */
export function useFreshness({
  baseline,
  isEditing = false,
  pollIntervalMs = 60_000,
}: UseFreshnessOptions): FreshnessResult {
  const [latest, setLatest] = useState<FreshnessCheck | null>(null);

  useEffect(() => {
    if (!baseline) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    async function poll() {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      try {
        const res = await fetch("/api/health");
        if (!res.ok) return; // Ignore failed poll
        const json = (await res.json().catch(() => null)) as any;
        if (
          !cancelled &&
          json &&
          typeof json.asOfRound === "number" &&
          typeof json.checkedAt === "string"
        ) {
          setLatest({
            asOfRound: json.asOfRound,
            checkedAt: json.checkedAt,
          });
        }
      } catch {
        // Ignore network errors
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void poll();
      }
    }

    timer = setInterval(() => {
      void poll();
    }, pollIntervalMs);

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
    };
  }, [baseline?.asOfRound, baseline?.checkedAt, pollIntervalMs]);

  if (!baseline) {
    return { status: "none", message: null, newRound: null };
  }

  return decideFreshness(baseline, latest, isEditing);
}
