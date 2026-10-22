import { useEffect, useRef, useState, type FormEvent } from "react";

interface TokenDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (token: string, remember: boolean) => Promise<{ ok: boolean; error?: string }>;
}

const BTN = "type-label h-9 rounded-control border px-3 disabled:cursor-not-allowed";
const BTN_PLAIN = `${BTN} border-line text-text-2 hover:border-accent-hover disabled:text-text-3 disabled:hover:border-line`;
const BTN_PRIMARY = `${BTN} border-accent-fill bg-accent-fill text-text hover:bg-accent-fill-hover disabled:border-line disabled:bg-s2 disabled:text-text-3`;
const INPUT = "type-body h-9 w-full min-w-0 rounded-control border border-line bg-s2 px-3 text-text placeholder:text-text-3 focus:outline-2 focus:outline-accent-hover focus:outline-offset-2";

export function TokenDialog({ open, onClose, onSubmit }: TokenDialogProps) {
  const [token, setToken] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setToken("");
      setError(null);
      setBusy(false);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await onSubmit(token, remember);
      if (!res.ok) {
        setError(res.error ?? "The token was not accepted. Check that you typed it right.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="token-dialog-title"
        className="flex w-full max-w-md flex-col gap-4 rounded-panel border border-line bg-s1 p-5 shadow-2xl"
      >
        <div className="flex flex-col gap-1">
          <h2 id="token-dialog-title" className="type-title text-text">
            Enter write token
          </h2>
          <p className="type-note text-text-2">
            This server requires a token to save or share scenarios from other devices.
          </p>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ttf-write-token-input" className="type-label text-text-2">
              Write token
            </label>
            <input
              ref={inputRef}
              id="ttf-write-token-input"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste TTF_WRITE_TOKEN here"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "token-error" : undefined}
              className={INPUT}
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              id="remember-token-checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 rounded border-line bg-s2 accent-accent-fill focus:outline-2 focus:outline-accent-hover"
            />
            <span className="type-note text-text-2">Remember on this device</span>
          </label>

          {error ? (
            <p id="token-error" role="alert" className="type-note text-red">
              {error}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className={BTN_PLAIN}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || token.trim() === ""}
              className={BTN_PRIMARY}
            >
              {busy ? "Checking…" : "Save token"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
