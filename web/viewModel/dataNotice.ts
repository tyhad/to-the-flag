import type { SeasonState } from "../../engine";

/** The notice shown when the latest data check did not pass cleanly (DESIGN.md section 6, States). Pure. */

export interface DataNotice {
  tone: "warn" | "fail";
  title: string;
  hint: string;
}

/** Null when the data check is healthy. `asOfRound` is the round of the data being shown. */
export function dataNotice(health: SeasonState["health"], asOfRound: number): DataNotice | null {
  if (health.status === "warn") {
    return {
      tone: "warn",
      title: "Data check warning: the latest import flagged something to review.",
      hint: "The standings are shown as loaded.",
    };
  }
  if (health.status === "fail") {
    return {
      tone: "fail",
      title: `Data check failed. Showing last valid data from Round ${asOfRound}.`,
      hint: "Run the F1GStats data check again to see what failed, then reload this page.",
    };
  }
  return null;
}
