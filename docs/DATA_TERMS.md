# Data terms

To the Flag and F1GStats show data they fetch from other sources. A free API is not the same as free reuse of its data, so each source's terms are recorded here, with what the owner concluded (D56).

**The owner fills the last two columns before the release (Phase 10, Step 8).** "What the source says" below is only what was found while preparing Step 5, with where it was found; it is not legal advice and not a conclusion. If a source's terms do not fit the intended use, stop and decide before tagging `v1.0.0`.

| Source | Used for | Terms or license | What the source says (found, not concluded) | Date checked | Owner's conclusion |
|---|---|---|---|---|---|
| Jolpica F1 API (`api.jolpi.ca`), successor to the Ergast API | Schedules, results and standings (F1GStats, through FastF1's Ergast interface) | Terms of Use: <https://github.com/jolpica/jolpica-f1/blob/main/TERMS.md>. Rate limits: <https://github.com/jolpica/jolpica-f1/blob/main/docs/rate_limits.md> | A free service with its own Terms of Use. Rate limit of 4 requests per second (burst) and 500 requests per hour (sustained), as quoted by third-party client libraries; read the page itself. F1GStats makes a handful of requests per run. | TODO (owner) | TODO (owner) |
| FastF1 (Python library) | Session schedule and session data (F1GStats) | Documentation: <https://docs.fastf1.dev>. Code and license: <https://github.com/theOehrly/Fast-F1> | A library with its own license (reported as MIT by third parties; read the repository's license file). It fetches data from other providers, so the library's license does not cover that data. The documentation says FastF1 is unofficial and not associated with the Formula 1 companies. | TODO (owner) | TODO (owner) |
| OpenF1 | Starting-grid information (F1GStats) | Documentation: <https://openf1.org/docs> | The documentation says historical data (2023 onwards) is free and needs no authentication, and real-time data needs a paid subscription. No separate terms page was found; check the site for one. | TODO (owner) | TODO (owner) |

## How to fill a row

1. Open the terms or license link. If the source has no terms page, say so in "Owner's conclusion".
2. Write the date you read it in "Date checked" (`YYYY-MM-DD`).
3. In "Owner's conclusion", write in one or two sentences whether the use here (a personal, local tool whose repositories are public but have no license, run on one machine) fits, and why.

Nothing in the app or its repositories redistributes these sources' data: the SQLite file F1GStats writes stays on the owner's machine, and the app shows numbers computed from it. No F1 logo, font or picture is used.
