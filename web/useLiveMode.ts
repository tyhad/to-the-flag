import { useCallback, useEffect, useState } from "react";
import { parseLiveStateResponse, type LiveModeFeed } from "./viewModel/liveMode";

const POLL_INTERVAL_MS = 2000;

export interface LiveModeState {
  enabled: boolean;
  toggle: () => void;
  feed: LiveModeFeed | null;
  error: boolean;
}

/**
 * Polls `GET /api/live/state` every 2 seconds while Live Mode is enabled.
 * Same-origin relative URL only: zero external network requests.
 */
export function useLiveMode(): LiveModeState {
  const [enabled, setEnabled] = useState(false);
  const [feed, setFeed] = useState<LiveModeFeed | null>(null);
  const [error, setError] = useState(false);

  const toggle = useCallback(() => {
    setEnabled((prev) => !prev);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setError(false);
      return;
    }

    let cancelled = false;
    let activeController: AbortController | null = null;

    const poll = async () => {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      try {
        const res = await fetch("/api/live/state", {
          cache: "no-store",
          signal: controller.signal,
        });
        const body: unknown = await res.json().catch(() => null);
        if (cancelled) return;
        const parsed = parseLiveStateResponse(res.ok, body);
        if (parsed) {
          setFeed(parsed);
          setError(false);
        } else {
          setError(true);
        }
      } catch {
        if (!cancelled && !controller.signal.aborted) {
          setError(true);
        }
      }
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      activeController?.abort();
    };
  }, [enabled]);

  return { enabled, toggle, feed, error };
}
