# History Fetch Notes (Seasons 2022 - 2025)

Catatan hasil fetch data historis F1 menggunakan `F1GStats/fetch_f1_data.py` untuk kalibrasi dan evaluasi Model v2 (Phase 4, Step 1).
Data disimpan di `../F1GStats/history/f1gstats-<season>.sqlite` (diabaikan oleh git).

## Ringkasan

| Season | Exit Code | Data Health | Total Rounds | Completed | Sprints | GP Rows | Sprint Rows | Qualifying | Drivers | Constructors |
|--------|-----------|-------------|--------------|-----------|---------|---------|-------------|------------|---------|--------------|
| 2022   | 0         | `warn`      | 22           | 22        | 3       | 440     | 60          | 440        | 22      | 10           |
| 2023   | 0         | `warn`      | 22           | 22        | 6       | 440     | 120         | 440        | 22      | 10           |
| 2024   | 0         | `warn`      | 24           | 24        | 6       | 479     | 120         | 479        | 24      | 10           |
| 2025   | 0         | `ok`        | 24           | 24        | 6       | 479     | 120         | 479        | 21      | 10           |

Semua 4 musim berhasil di-fetch dengan exit code 0 dan lulus validasi (`ok` atau `warn`), memenuhi kriteria minimal 3 dari 4 musim valid.

---

## Detail per Musim

### Season 2022
- **Command:** `python fetch_f1_data.py --season 2022 --output .\history\f1gstats-2022.sqlite`
- **Exit Code:** 0
- **Data Health:** `warn`
- **Schedule:** 22 round (3 sprint, 22 completed)
- **Baris Data:**
  - `race_results` (GP): 440 baris (22 round)
  - `race_results` (Sprint): 60 baris (3 round)
  - `qualifying_results`: 440 baris (22 round)
  - `driver_standings`: 22 driver
  - `constructor_standings`: 10 tim
  - `starting_grid`: 20 baris
  - `sessions`: 5
- **Catatan Validasi:**
  - V1 [ok]: Total poin driver = total poin konstruktor (2350).
  - V2 [warn]: Total poin GP round 1..22 bernilai 102 (karena aturan bonus 1 poin fastest lap pada 2022-2024, di luar skala standar 101 tanpa FL). Ini adalah warning yang diharapkan.
  - V3 [ok], V4 [ok], V5 [ok], V6 [ok].

---

### Season 2023
- **Command:** `python fetch_f1_data.py --season 2023 --output .\history\f1gstats-2023.sqlite`
- **Exit Code:** 0
- **Data Health:** `warn`
- **Schedule:** 22 round (6 sprint, 22 completed)
- **Baris Data:**
  - `race_results` (GP): 440 baris (22 round)
  - `race_results` (Sprint): 120 baris (6 round)
  - `qualifying_results`: 440 baris (22 round)
  - `driver_standings`: 22 driver
  - `constructor_standings`: 10 tim
  - `starting_grid`: 20 baris
  - `sessions`: 5
- **Catatan Validasi:**
  - V1 [ok]: Total poin driver = total poin konstruktor (2458).
  - V2 [warn]: Total poin GP bernilai 102 karena fastest lap point. Sesuai ekspektasi.
  - V3 [ok], V4 [ok], V5 [ok], V6 [ok].

---

### Season 2024
- **Command:** `python fetch_f1_data.py --season 2024 --output .\history\f1gstats-2024.sqlite`
- **Exit Code:** 0
- **Data Health:** `warn`
- **Schedule:** 24 round (6 sprint, 24 completed)
- **Baris Data:**
  - `race_results` (GP): 479 baris (24 round)
  - `race_results` (Sprint): 120 baris (6 round)
  - `qualifying_results`: 479 baris (24 round)
  - `driver_standings`: 24 driver
  - `constructor_standings`: 10 tim
  - `starting_grid`: 20 baris
  - `sessions`: 5
- **Catatan Validasi:**
  - V1 [ok]: Total poin driver = total poin konstruktor (2659).
  - V2 [warn]: Total poin GP bernilai 102 karena fastest lap point. Sesuai ekspektasi.
  - V3 [ok], V4 [ok], V5 [ok].
  - V6 [warn]: Standings memiliki 24 driver (adanya pergantian pembalap di tengah musim seperti Ricciardo/Lawson, Bearman, Colapinto/Sargeant), sementara grid race per seri adalah 19-20 pembalap.

---

### Season 2025
- **Command:** `python fetch_f1_data.py --season 2025 --output .\history\f1gstats-2025.sqlite`
- **Exit Code:** 0
- **Data Health:** `ok`
- **Schedule:** 24 round (6 sprint, 24 completed)
- **Baris Data:**
  - `race_results` (GP): 479 baris (24 round)
  - `race_results` (Sprint): 120 baris (6 round)
  - `qualifying_results`: 479 baris (24 round)
  - `driver_standings`: 21 driver
  - `constructor_standings`: 10 tim
  - `starting_grid`: 20 baris
  - `sessions`: 5
- **Catatan Validasi:**
  - V1 s/d V6 semua [ok].
