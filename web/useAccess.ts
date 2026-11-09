import { useCallback, useEffect, useState } from "react";
import {
  decideAccessState,
  readStoredToken,
  saveToken,
  clearToken as clearStoredToken,
  type AccessVerdict,
} from "./viewModel/access";
import { scenarioApi, setApiToken, setOnUnauthorized } from "./scenarioApi";

export interface AccessInfo {
  verdict: AccessVerdict;
  writeRequiresToken: boolean;
  canWrite: boolean;
  dialogOpen: boolean;
  openDialog: () => void;
  closeDialog: () => void;
  submitToken: (token: string, remember: boolean) => Promise<{ ok: boolean; error?: string }>;
  clear: () => void;
}

export function useAccess(): AccessInfo {
  const [verdict, setVerdict] = useState<AccessVerdict>("open");
  const [writeRequiresToken, setWriteRequiresToken] = useState(false);
  const [canWrite, setCanWrite] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  const openDialog = useCallback(() => setDialogOpen(true), []);
  const closeDialog = useCallback(() => setDialogOpen(false), []);

  useEffect(() => {
    let cancelled = false;
    const stored = readStoredToken();
    if (stored.token) {
      setApiToken(stored.token);
    }

    (async () => {
      const res = await scenarioApi.checkAccess(stored.token);
      if (cancelled) return;
      if (!res.ok) {
        setVerdict("error");
        return;
      }
      const v = decideAccessState(res.data);
      setVerdict(v);
      setWriteRequiresToken(res.data.writeRequiresToken);
      setCanWrite(res.data.canWrite);
    })();

    setOnUnauthorized(() => {
      setDialogOpen(true);
    });

    return () => {
      cancelled = true;
      setOnUnauthorized(null);
    };
  }, []);

  const submitToken = useCallback(async (token: string, remember: boolean) => {
    const clean = token.trim();
    if (!clean) {
      return { ok: false, error: "Enter a token." };
    }

    const res = await scenarioApi.checkAccess(clean);
    if (!res.ok) {
      return { ok: false, error: "Could not reach the server. Try again." };
    }

    if (!res.data.canWrite) {
      return {
        ok: false,
        error: "The token was not accepted. Check that you typed it right.",
      };
    }

    saveToken(clean, remember);
    setApiToken(clean);
    setVerdict("open");
    setCanWrite(true);
    setDialogOpen(false);
    return { ok: true };
  }, []);

  const clear = useCallback(async () => {
    clearStoredToken();
    setApiToken(null);
    const res = await scenarioApi.checkAccess(null);
    if (res.ok) {
      setVerdict(decideAccessState(res.data));
      setCanWrite(res.data.canWrite);
      setWriteRequiresToken(res.data.writeRequiresToken);
    }
  }, []);

  return {
    verdict,
    writeRequiresToken,
    canWrite,
    dialogOpen,
    openDialog,
    closeDialog,
    submitToken,
    clear,
  };
}
