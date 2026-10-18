# Starting forces tables (input to tools/build_forces.mjs)

File: `tools/forces/<scenario id>.csv`, one per scenario. `tools/build_forces.mjs` turns it into
the scenario's starting navies, air forces and strategic capabilities and writes them into
`data/scenarios/<id>.json` (`fleets`, `wings`, and per-country `warheads`, `icbm`, `sats`,
`stations`, `colonies`). Rules of the game itself: docs/NAVY_AIR.md and docs/STRATEGIC.md.

## Run

```bash
node tools/build_forces.mjs modern_2026 cold_war_1962   # named scenarios
npm run build:forces                                     # every table in tools/forces/
```

`node tools/build_history.mjs` runs it for every scenario it builds that has a table, and
`npm run build:map` runs it for `modern_2026`. It rewrites the scenario file in place and is
idempotent: fleets and wings are replaced, and `warheads`, `icbm` and `sats` are cleared before
the table is applied. It prints a summary per scenario (countries, fleets, ships, wings, warheads)
and fails on an unknown tag.

## Columns

Lines starting with `#` and blank lines are ignored. The header must name the columns; values are
plain numbers (no commas inside a field; use `;` in notes).

| Column | Meaning | Becomes |
| --- | --- | --- |
| `tag` | Country tag in the scenario | |
| `carriers` | Aircraft carriers | sea role `carrier` |
| `capital` | Main battle ships (battleships, cruisers and large destroyers in modern navies) | sea role `capital` |
| `screens` | Escorts: destroyers, frigates, corvettes | sea role `screen` |
| `subs` | Diesel-electric submarines | sea role `sub` |
| `nsubs` | Nuclear attack and cruise-missile submarines | sea role `nsub` |
| `ssbns` | Ballistic missile submarines | sea role `ssbn` |
| `fighters` | Fighter and multirole aircraft | air role `fighter` |
| `bombers` | Bombers | air role `bomber` |
| `attack` | Ground-attack aircraft and attack helicopters | air role `attack` |
| `drones` | Armed drones | air role `drone` |
| `warheads` | Nuclear warheads (total inventory) | `warheads` |
| `icbms` | Ballistic missile launchers | `icbm` |
| `satellites` | Military satellites | `sats` by kind |
| `stations`, `colonies` | Optional: orbital stations, off-world settlements | copied as given |
| `note` | Sources and caveats; ignored by the builder | |

## How counts become units

1. **Technology**: the country's technology year is its `techYear` (else the scenario's, else
   the start year) minus its `techLag`. It knows every technology up to that year with its
   prerequisites, plus its listed `techs`; fictional technologies only if the scenario is
   `fictional`. Dormant countries and countries without provinces are skipped.
2. **Unit type**: each column becomes the **newest unit of that domain and role** the country
   knows (by its technology's year). If it knows none (e.g. no aircraft before Powered Flight),
   the column is dropped.
3. **Group size**: one unit stands for `group` real ships or aircraft (`data/rules/units.json`:
   e.g. 4 destroyers, 1 carrier, 10 galleys, 24 fighters, 12 bombers). Units =
   round(count ÷ group); counts below half a group give nothing.
4. **Upkeep cap**: naval plus air upkeep may be at most **15% of a typical monthly tax revenue**
   (GDP from the scenario's provinces × 0.22 × 0.85 ÷ 12, GDP = population × 400 × 1.06^dev).
   Above that, every type is scaled down proportionally (rounded down); a country that had
   carriers or ballistic missile submarines keeps at least one of each. Land armies are capped
   separately by tools/build_history.mjs.

## Placement

- **Ports**: the country's coastal provinces with a port, by size (population × (1 + dev ÷ 50)),
  taking up to 3 whose main sea zones differ. Surface ships and attack submarines are split
  100% (one port), 60/40 (two) or 50/30/20 (three), each share docked as a fleet in its port.
- **SSBN patrols**: ballistic missile submarines form a separate fleet named "Deterrent Patrol",
  **at sea** in the main zone of the largest port, so they count as sea-based launchers from day
  one.
- **Air bases**: the capital, then the largest provinces; up to 4 bases, used in turn.
- **Wing packing**: each aircraft type is split into wings of max(6, ⌈units ÷ 6⌉) units, so no
  type starts with more than about 6 wings, however large the air force (keeps the daily air pass
  cheap). Missions: fighters `superiority`, bombers `idle`, others `support`.
- A country without a port gets no ships, even if the table lists some.

## Strategic columns

- `warheads` only if the country knows Atomic Bomb at its technology year; `icbms` only with
  Ballistic Missiles (`icbm`).
- `satellites` only with Satellites. They are split 40% reconnaissance (at least 1), 30%
  communications, 15% navigation (only with Satellite Navigation) and 15% early warning; the
  remainder goes to reconnaissance. Each kind is then capped at **12** (three times the
  `strategic.satCoverage` of 4 that gives full effect), because more satellites only add upkeep.
- `stations` and `colonies` are copied as given; the game installs them only for countries that
  know Orbital Industry or Off-World Settlement. (The builder does not clear them when the
  column is removed from a table.)
- In the game, a starting arsenal sets the nuclear programme to the largest level it already
  meets (docs/STRATEGIC.md).

## Sources

The tables for 1914, 1936, 1962 and 2026 are rounded public figures (fleet lists, IISS Military
Balance and SIPRI for the modern world); each row's `note` says what was counted and how
confident the figure is. The 2035 and 2085 tables are **invented** for the fictional scenarios.
