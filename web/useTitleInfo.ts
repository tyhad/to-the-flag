import { useCallback, useState } from "react";
import {
  readTitleInfo,
  resolveTitleInfoStorage,
  writeTitleInfo,
  type TitleInfoMode,
  type TitleInfoStorage,
} from "./viewModel/titleInfo";

/**
 * The "Title info" choice (auto, on or off), remembered in the browser. The default is auto; storage that is
 * missing or blocked also gives auto, and the choice then lasts until the page is closed.
 * `storage` is only for tests; the page uses the browser's localStorage.
 */
export function useTitleInfo(storage?: TitleInfoStorage): [TitleInfoMode, (mode: TitleInfoMode) => void] {
  const [mode, setMode] = useState<TitleInfoMode>(() => readTitleInfo(storage ?? resolveTitleInfoStorage()));
  const choose = useCallback(
    (next: TitleInfoMode) => {
      setMode(next);
      writeTitleInfo(next, storage ?? resolveTitleInfoStorage());
    },
    [storage],
  );
  return [mode, choose];
}
