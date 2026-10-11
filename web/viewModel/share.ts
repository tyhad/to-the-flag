/**
 * Share links (DESIGN.md section 6). A link is `#s=<code>&r=<round>`: the code is the scenario
 * (shared/shareCodec), the round is the data round it was made at, so an older link can warn.
 */
import { InvalidScenarioError, validateScenario, type Scenario, type SeasonState } from "../../engine";
import { decodeScenario } from "../../shared/shareCodec";
import { describeScenarioError } from "./locks";

export interface ShareHash {
  code: string;
  /** The data round the link was made at. Null for a link without one. */
  asOfRound: number | null;
}

export function buildShareHash(code: string, asOfRound: number): string {
  return `#s=${code}&r=${asOfRound}`;
}

/** Null when the hash is not a share link. */
export function parseShareHash(hash: string): ShareHash | null {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const code = params.get("s");
  if (!code) return null;
  const round = params.get("r");
  return { code, asOfRound: round !== null && /^\d+$/.test(round) ? Number(round) : null };
}

export type ImportAssessment =
  | { ok: true; scenario: Scenario; contenders?: string[]; warning: string | null }
  | { ok: false; message: string };

/** Check a decoded link against the current data. A bad scenario is refused; an old round only warns. */
export function assessImport(
  state: SeasonState,
  decoded: { scenario: Scenario; contenders?: string[] },
  linkRound: number | null,
): ImportAssessment {
  try {
    validateScenario(state, decoded.scenario);
  } catch (error) {
    if (error instanceof InvalidScenarioError) {
      return { ok: false, message: `That link does not fit the current data. ${describeScenarioError(error)}` };
    }
    throw error;
  }
  let warning: string | null = null;
  if (linkRound !== null && linkRound < state.asOfRound) {
    warning = `This link was made at Round ${linkRound}. Data is now at Round ${state.asOfRound}, so the results may differ.`;
  } else if (linkRound !== null && linkRound > state.asOfRound) {
    warning = `This link was made with newer data (Round ${linkRound}) than yours (Round ${state.asOfRound}). Results may differ.`;
  }
  return {
    ok: true,
    scenario: decoded.scenario,
    ...(decoded.contenders ? { contenders: decoded.contenders } : {}),
    warning,
  };
}

/** Read a share link from the page's hash. Null when there is none. Never throws. */
export async function importFromHash(state: SeasonState, hash: string): Promise<ImportAssessment | null> {
  const link = parseShareHash(hash);
  if (!link) return null;
  let decoded: Awaited<ReturnType<typeof decodeScenario>>;
  try {
    decoded = await decodeScenario(link.code);
  } catch {
    return { ok: false, message: "That link is not valid. Ask for a new one." };
  }
  const contenders = decoded.contenders?.filter((c): c is string => typeof c === "string");
  return assessImport(state, { scenario: decoded.scenario, ...(contenders ? { contenders } : {}) }, link.asOfRound);
}
