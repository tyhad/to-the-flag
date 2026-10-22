interface NewDataNoticeProps {
  message: string;
  onReload?: () => void;
}

const BTN = "type-label h-8 rounded-control border px-3 disabled:cursor-not-allowed";
const BTN_PRIMARY = `${BTN} border-accent-fill bg-accent-fill text-text hover:bg-accent-fill-hover`;

/**
 * Banner shown when fresh season data is detected by background polling.
 * Never reloads automatically: lets the user decide when to reload.
 */
export function NewDataNotice({ message, onReload }: NewDataNoticeProps) {
  function handleReload() {
    if (onReload) {
      onReload();
    } else if (typeof window !== "undefined") {
      window.location.reload();
    }
  }

  return (
    <div
      role="status"
      className="col-span-3 flex items-center justify-between gap-3 rounded-panel border border-accent bg-s1 px-4 py-2.5"
    >
      <p className="type-label text-text">{message}</p>
      <button
        type="button"
        onClick={handleReload}
        className={BTN_PRIMARY}
      >
        Reload
      </button>
    </div>
  );
}
