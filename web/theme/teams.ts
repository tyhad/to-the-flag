// Team identity colors for the web UI.
//
// DESIGN.md: this file and web/styles/theme.css are the only places allowed to contain raw hex.
// Components must call `teamColor(id)`; never type a team color anywhere else.
//
// Keys are Ergast/Jolpica `constructorId` values as stored in f1gstats.sqlite (`constructor_id`).
//
// `brand` is the team's own color (provided by the owner).
// `display` is what the UI draws on the dark panels (s1 #1e2124 and s2 #282c30). It equals `brand`
// unless `brand` has less than 3:1 contrast against those surfaces (Red Bull, Aston Martin,
// Cadillac, and Ferrari on raised rows). In those cases it is `brand` blended toward white just
// enough to reach 3:1. tests/teams.test.ts enforces this.

export interface TeamColor {
  name: string;
  brand: string;
  display: string;
}

export const TEAM_COLORS: Readonly<Record<string, TeamColor>> = {
  mclaren: { name: "McLaren", brand: "#ff8000", display: "#ff8000" },
  mercedes: { name: "Mercedes", brand: "#27f4d2", display: "#27f4d2" },
  red_bull: { name: "Red Bull", brand: "#0600ef", display: "#6561f5" },
  ferrari: { name: "Ferrari", brand: "#e80020", display: "#e90827" },
  williams: { name: "Williams", brand: "#00a0dd", display: "#00a0dd" },
  rb: { name: "Racing Bulls", brand: "#fcd700", display: "#fcd700" },
  aston_martin: { name: "Aston Martin", brand: "#00665f", display: "#2e827c" },
  haas: { name: "Haas", brand: "#b6babd", display: "#b6babd" },
  audi: { name: "Audi", brand: "#ff2d00", display: "#ff2d00" },
  alpine: { name: "Alpine", brand: "#ff87bc", display: "#ff87bc" },
  cadillac: { name: "Cadillac", brand: "#444444", display: "#757575" },
};

/** Used for an unknown team id. Resolves to the hairline color from theme.css. */
export const FALLBACK_TEAM_COLOR = "var(--color-line)";

/** The color to draw for a team: a 3px identity strip or a 10px dot, nothing else. */
export function teamColor(constructorId: string): string {
  return TEAM_COLORS[constructorId]?.display ?? FALLBACK_TEAM_COLOR;
}
