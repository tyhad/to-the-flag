# To the Flag — Design System
> Timing-tower data interface on a dark slate base. Tonal surfaces instead of shadows, timing-screen colors that carry meaning, one sage accent for anything the user does.

**Status:** v0.2. Theme approved by the owner. Project name and tagline still pending (see SPEC.md, D3).
**Theme:** dark only
**Reference:** LiveOverlay `DESIGN.md`. Only the slate base and the sage accent are shared. Neumorphism is intentionally dropped because dual shadows hurt legibility in dense tables and disappear under stream compression.

This tool is shown on screen-share and stream. Every decision below favors legibility at a distance and after video compression over decoration.

---

## 1. Principles

1. **Color means one thing.** Sage = "the user did this" (selection, lock, primary action). Timing colors (purple, green, yellow, orange, red) = "the data says this". Never use one for the other's job.
2. **Tonal depth, not shadow.** Surfaces separate by lightness steps (`s0` → `s1` → `s2`) and hairlines. No drop shadows. The only glow is for a clinched title.
3. **Numbers are the hero.** Probabilities and points use the condensed display face at large size. Everything else stays quiet.
4. **Motion answers an action.** When the user changes a result, rows re-sort and numbers tween. Nothing animates on its own.
5. **Never signal by color alone.** Pair color with a label or icon (▲ ▼ ● text).

## 2. Tokens: Colors

| Token | Hex | Role |
|---|---|---|
| `--color-s0` | `#14161a` | App background |
| `--color-s1` | `#1e2124` | Panels (same as LiveOverlay studio canvas) |
| `--color-s2` | `#282c30` | Raised rows, hover, selected row |
| `--color-line` | `#3a4046` | Decorative hairlines only (1.5:1, never the sole boundary of a control) |
| `--color-text` | `#ffffff` | Primary text and numerals |
| `--color-text-2` | `#c2c6be` | Secondary text |
| `--color-text-3` | `#9ba1a8` | Muted text. Minimum allowed for small text |
| `--color-accent` | `#7b8472` | Sage: borders, icons, lock marks (4.15:1 on s1, non-text only) |
| `--color-accent-hover` | `#8e9884` | Focus ring, hover borders |
| `--color-accent-text` | `#a9b39e` | Sage used as text or link |
| `--color-accent-fill` | `#5b6453` | Button fill with white text (6.19:1) |
| `--color-accent-fill-hover` | `#66705d` | Button hover (5.20:1) |
| `--color-purple` | `#c084fc` | Clinched / best |
| `--color-green` | `#3ddc84` | Gain, easy path |
| `--color-yellow` | `#ffd23f` | At risk, hard path |
| `--color-orange` | `#ff9f43` | Very hard path |
| `--color-red` | `#ff6b63` | Loss, delta down |

Eliminated is **not** a color: render the row in `text-3` with a line-through on the name.

Contrast was computed (WCAG 2.x). Text colors above are ≥ 5.0:1 on `s1` and `s2`. Filled badges use `s0` as text color (≥ 6.5:1 on all four timing colors).

**Team colors:** source of truth is `web/theme/teams.ts` (keyed by Ergast `constructorId`). Each team has a `brand` color (owner-provided) and a `display` color for the dark surfaces: equal to `brand`, except where `brand` has less than 3:1 contrast against `s1`/`s2` (Red Bull, Aston Martin, Cadillac, and Ferrari on raised rows), where it is blended toward white just enough to reach 3:1. Draw only `display`, only as a 3px identity strip or a 10px dot, and only through `teamColor(id)`. Unknown team: `--color-line`. Never type a team hex anywhere else.

**Glow (only for clinched):** `0 0 12px rgba(192, 132, 252, 0.35)`.

## 3. Tokens: Typography

Fonts are **self-hosted** (the app is local-first and must work offline). No CDN links.

| Role | Family | Weight | Size / line | Notes |
|---|---|---|---|---|
| display-num | Barlow Condensed | 700 | 48 / 1.0 | Key probability, points gap |
| heading | Barlow Condensed | 700 | 28 / 1.15 | Panel titles |
| title | Barlow Condensed | 600 | 20 / 1.2 | Section titles, driver codes |
| data | Barlow Condensed | 600 | 16 / 1.2 | Table numerals |
| body | Barlow | 400–500 | 16 / 1.5 | Sentences, descriptions |
| label | Barlow | 600 | 14 / 1.3 | Buttons, field labels |
| caption | Barlow | 500 | 13 / 1.4 | Non-essential hints only |

- Minimum text size is **13px**, and only for non-essential hints. Anything the audience must read is **≥ 14px**.
- Numerals in tables use `font-variant-numeric: tabular-nums`. The agent must verify digits do not shift width when values change; if the font lacks tabular figures, fix column widths instead.
- Sentence case everywhere. No all-caps labels, no tracked-out eyebrows.

## 4. Tokens: Shape, spacing, elevation

- Spacing: use the **Tailwind default scale**. Do not redefine `--spacing-N` in `@theme` (it collides with Tailwind's numeric utilities).
- Radius: panels `12px`, controls `8px`, table rows `0`, status tags use a 6px chamfer (`clip-path`). Radii differ on purpose; do not apply one radius to everything.
- Row height: 40px. Panel padding: 16px. Gap between panels: 12px.
- Elevation: none. Use `s0/s1/s2` plus a 1px `--color-line` hairline between rows.
- Focus: 2px `--color-accent-hover` outline with 2px offset on every interactive element. Never remove it.

## 5. Layout

Fixed-viewport app, designed for a 1920×1080 screen-share and usable at 1280 wide.

```
┌───────────────────────────────────────────────────────────────────────────┐
│ To the Flag                            Season 2026 · as of Round N  [Scn▾]│
├──────────────┬────────────────────────────────────────┬───────────────────┤
│ SESSIONS     │ PROJECTED STANDINGS   [WDC] [WCC]      │ Possible?  Likely?│
│ (320px)      │ ▌1 VER  412 → 437  ▲25   Clinched      │ ┌───────────────┐ │
│ R19 Race ◉   │ ▌2 NOR  398 → 410  ▲12   Alive         │ │ Path Solver   │ │
│  locked      │ ▌3 PIA  371 → 371        Alive         │ │ needs 3 of 5  │ │
│ R19 Sprint ○ │ ▌4 LEC  ...                            │ ├───────────────┤ │
│  open        │                                        │ │ Odds (model)  │ │
│ [contenders] │ Finish Lane (gap to the line)          │ │ estimate      │ │
├──────────────┴────────────────────────────────────────┴───────────────────┤
│ Scenario strip:  [Base] [Norris wins all] [+ New]    [Compare] [Export]   │
└───────────────────────────────────────────────────────────────────────────┘
```

- Left rail 320px, right rail 360px, center flexible. Left-aligned text; numerals right-aligned in columns.
- "Possible?" (Path Solver, no model) and "Likely?" (Odds, Monte Carlo) are **separate tabs with separate visual treatment**. Never merge them into one number.

## 6. Components

**Tower row.** `s1` row, 40px, 3px team strip at left, position (data), driver code (title), points `current → projected` (data), delta chip, status tag. Selected row = `s2` + 2px `accent` left border. Eliminated row = `text-3` + line-through.

**Status tag.** Chamfered, filled, `s0` text, sentence case. Clinched = purple (+ glow). Alive = green. Long shot = yellow. Eliminated = no fill, `text-3`.

**Delta chip.** `▲ 12` in green or `▼ 8` in red, `data` size. Zero shows `●` in `text-3`.

**Probability bar.** 8px track in `s2`, fill in a timing color chosen by band (configurable, default: ≥ 50% green, 10–50% yellow, < 10% orange). Value in `display-num` or `data`. Always accompanied by the text "Model estimate". Never render `0%` or `100%` from simulation; show `<1%` or `>99%`.

**Session card (left rail).** Header: round + session (Race/Sprint). State toggle: **Open** (outlined, `accent` border) or **Locked** (filled `accent-fill`, lock icon). Locked cards expand to the position picker.

**Position picker.** Slots P1–P10 (Race) or P1–P8 (Sprint) as a vertical list. Contender mode: only contenders are assignable; each slot accepts one driver; a driver can be marked "out" (no points / DNF). Quick presets above the picker: "Contender wins", "Rival out", "Clear".

**Path card ("Possible?").** Title is the verdict in plain words. Body: minimum conditions, easiest path, only-path (extreme). A difficulty meter shows the share of remaining points needed, colored green → yellow → orange. No percentages implying probability.

**Odds panel ("Likely?").** Probability bars per contender, delta vs the base scenario, "as of Round N", and a visible `low confidence` tag early in the season.

**Scenario strip.** Chips for saved scenarios. Compare mode shows two scenarios side by side with differences highlighted.

**Finish Lane (signature element).** A horizontal lane per contender. Distance along the lane = projected points; a chequered finish line at the right marks the points needed to clinch; locked sessions fill segments of the lane in `accent`. This is the one memorable visual; keep everything else quiet. Build it in Phase 2 after the table works.

**States.** Empty: say what to do ("Lock a result to see the table change"). Error: say what failed and how to fix it; never apologize. Stale data: banner "Data check failed. Showing last valid data from Round N." with `yellow` icon.

## 7. Motion

- On any change: rows re-sort with a position-swap animation (≈ 250 ms) and numbers tween (≈ 300 ms). Use GSAP (already in the LiveOverlay stack) or CSS FLIP.
- No entrance animations, no hover animations on cards, no looping effects.
- Respect `prefers-reduced-motion`: swap instantly.

## 8. Content rules

- Plain words, active voice, sentence case. Buttons name the action: "Lock result", "Reset scenario", "Save scenario".
- Labels: **Possible?** (math, no assumptions) and **Likely?** (model).
- Always show "Model estimate" next to any simulated percentage and "as of Round N" in the header.
- Never show `0%` / `100%` from simulation. Deterministic states (Clinched, Eliminated) are stated in words.
- Numbers: points as integers (half points allowed), probabilities rounded to whole percent (one decimal below 10%).

## 9. Do / Don't

**Do**
- Use only tokens above; add a token before using a new color.
- Keep sage for user-driven state, timing colors for data meaning.
- Pair every color signal with text or an icon.
- Self-host fonts and assets.

**Don't**
- No neumorphic shadows, no drop shadows, no gradients as decoration.
- No pure-white panels; white is for text and numerals.
- Don't use red for "eliminated" (it reads as an alarm). Don't use purple for anything except clinched/best.
- Don't put text below 13px; don't use `text-3` on anything lighter than `s2`.
- Don't use one radius for everything; don't add all-caps labels or eyebrow text.

## 10. Quick start

```css
@theme {
  --color-s0: #14161a;
  --color-s1: #1e2124;
  --color-s2: #282c30;
  --color-line: #3a4046;
  --color-text: #ffffff;
  --color-text-2: #c2c6be;
  --color-text-3: #9ba1a8;
  --color-accent: #7b8472;
  --color-accent-hover: #8e9884;
  --color-accent-text: #a9b39e;
  --color-accent-fill: #5b6453;
  --color-accent-fill-hover: #66705d;
  --color-purple: #c084fc;
  --color-green: #3ddc84;
  --color-yellow: #ffd23f;
  --color-orange: #ff9f43;
  --color-red: #ff6b63;

  --font-display: "Barlow Condensed", "Arial Narrow", system-ui, sans-serif;
  --font-ui: "Barlow", system-ui, -apple-system, "Segoe UI", sans-serif;

  --radius-panel: 12px;
  --radius-control: 8px;
}
```

## 11. Agent checklist (before opening a PR)

- [ ] Only tokens from section 10 are used; no raw hex in components.
- [ ] Text ≥ 14px for anything the audience reads; `text-3` only on `s1`/`s2`.
- [ ] Every color signal has a text or icon pair.
- [ ] Possible? and Likely? are visually separate; simulated values are labeled "Model estimate".
- [ ] No `0%` / `100%` from simulation.
- [ ] Keyboard focus is visible on every control; reduced motion is respected.
- [ ] Fonts are bundled locally; the app works offline.