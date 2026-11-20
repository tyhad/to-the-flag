import { useState } from "react";
import type { SeasonState } from "../../engine";
import { exportPodiumCard } from "../exportCard";
import {
  buildPodiumView,
  podiumDriverOptions,
  podiumRaceLine,
  podiumRound,
  type PodiumMode,
} from "../viewModel/podiumCard";

const BTN = "type-label h-8 rounded-control border px-3 disabled:cursor-not-allowed";
const BTN_PLAIN = `${BTN} border-line text-text-2 hover:border-accent-hover disabled:text-text-3 disabled:hover:border-line`;
const SELECT = "type-body h-8 min-w-0 rounded-control border border-line bg-s2 px-2 text-text";

const EMPTY: [string, string, string] = ["", "", ""];

/**
 * A small podium picture: choose Prediction or Race result, pick P1, P2 and P3, and export a 1080×1080 PNG.
 * The picks are the owner's own and start empty; nothing is saved, a reload clears them. No token is needed.
 */
export function PodiumExport({ state }: { state: SeasonState }) {
  const [mode, setMode] = useState<PodiumMode>("prediction");
  const [codes, setCodes] = useState<[string, string, string]>(EMPTY);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const round = podiumRound(state, mode);
  const drivers = podiumDriverOptions(state);
  const ready = round !== null && codes.every((code) => code !== "");
  const raceLine = podiumRaceLine(state, mode);

  function choose(index: number, code: string) {
    setCodes((old) => {
      const next = [...old] as [string, string, string];
      next[index] = code;
      return next;
    });
  }

  async function exportPicture() {
    const view = buildPodiumView(state, mode, codes);
    if (!view) return;
    setExporting(true);
    setMessage(null);
    try {
      await exportPodiumCard(view);
    } catch {
      setMessage("Could not make the picture. Your browser may have blocked it.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <section aria-label="Export a podium picture" className="flex flex-col gap-2 border-t border-line pt-3">
      <h3 className="type-heading text-text">Podium picture</h3>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Podium picture mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as PodiumMode)}
          className={SELECT}
        >
          <option value="prediction">Prediction</option>
          <option value="result">Race result</option>
        </select>
        {codes.map((code, i) => (
          <select
            key={i}
            aria-label={`P${i + 1} driver`}
            value={code}
            onChange={(e) => choose(i, e.target.value)}
            className={SELECT}
          >
            <option value="">P{i + 1}</option>
            {drivers
              .filter((d) => d.code === code || !codes.includes(d.code))
              .map((d) => (
                <option key={d.code} value={d.code}>
                  {d.code}
                </option>
              ))}
          </select>
        ))}
        <button type="button" disabled={exporting || !ready} onClick={() => void exportPicture()} className={BTN_PLAIN}>
          {exporting ? "Exporting…" : "Export picture"}
        </button>
      </div>
      <p className="type-note text-text-2">{raceLine}</p>
      {message ? (
        <p role="status" className="type-note text-text-2">
          {message}
        </p>
      ) : null}
    </section>
  );
}
