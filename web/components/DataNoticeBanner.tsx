import type { DataNotice } from "../viewModel/dataNotice";
import { AlertIcon } from "./icons";

/** Shown under the header when the latest data check did not pass cleanly. The icon is paired with words. */
export function DataNoticeBanner({ notice }: { notice: DataNotice }) {
  const strong = notice.tone === "fail";
  return (
    <div
      role="status"
      className={`col-span-3 flex items-start gap-3 rounded-panel border bg-s1 px-4 ${strong ? "border-yellow py-3" : "border-line py-2"}`}
    >
      <AlertIcon className="mt-1 shrink-0 text-yellow" />
      <p className="type-label text-text">
        {notice.title} <span className="type-note text-text-2">{notice.hint}</span>
      </p>
    </div>
  );
}
