# Architecture

## Stack decision

**Chosen: plain JavaScript (ES modules) + Canvas 2D in the browser, zero runtime dependencies.
Offline data pipeline in Python + Shapely.**

What was evaluated, briefly:

| Option | Verdict |
| --- | --- |
| Godot 4 + GDScript | First choice on paper for a native 2D strategy game. **Not installable here**: the build container blocks GitHub/Godot downloads, so it could not be run or tested. |
| Unity / Unreal / Electron | Rejected by the low-end-first requirement (install size, memory). |
| C++ / SDL | Too much engine work before gameplay; no measured need. |
| TypeScript + map library (e.g. MapLibre) | Map libraries bring WebGL tiles and much more than a province map needs. |
| **Vanilla JS + Canvas 2D** | Runs and is testable here (Node + headless Chromium), no build step, ~3.3 MB total data, runs on any machine with a browser; simulation code also runs in Node for tests and benchmarks. |

A native desktop release can wrap the same files in a lightweight shell (Tauri or Neutralinojs,
both using the OS webview, ~5–10 MB) without code changes. That packaging is not done yet.

## Layers

```
data/ (JSON) ──► src/core (simulation, pure functions on plain state; runs in Node and browser)
                    ▲  commands (recruit, move, declare war, peace…)
src/ui (DOM HUD) ───┘  reads state, never mutates it outside core functions
src/map (Canvas) ──── reads state + static map; never drives simulation
```

- **Static map** (`mapdata.js`): decoded once into typed arrays — province centroids, bounding
  boxes, area, terrain, two levels of geometry, shared border polylines, and adjacency in CSR form
  (`adjStart/adj/adjKind/adjKm`). Shared by every system; never copied.
- **Game state** (`state.js`): plain data. Per-province fields are typed arrays
  (`owner, controller, pop, dev, fort, siege, siegeBy`), countries/armies/wars are small object
  arrays. Everything needed to continue a game is in `state` (including the RNG state), so saves
  are exact and the simulation is deterministic for a given seed and command sequence.
- **Rules** (`data/rules/*.json`): unit stats and balance constants, validated on load (`rules.js`).

## Simulation clock (`sim.js`)

One tick = one day. Daily: recruitment, movement, battle detection/resolution, sieges,
organisation recovery, construction, domestic events (each country checked once a month,
spread across days), AI diplomacy (each country every 3 months, spread across days). AI military: each country thinks every 7 days, staggered by country index so ~1/7
of countries run per tick. Monthly (1st of month): production, world market, consumption and
their effects, budget, reinforcement, war scores, government (approval, legitimacy, elections,
coups, revolutions, AI policies), diplomacy (influence, reputation, modifier decay, tribute and
reparations, expiring claims), AI peace evaluation, AI investment, country caches. The renderer has no influence on the clock; the UI loop runs ticks
within a per-frame time budget, so fast-forward cannot freeze the interface.

## Systems

- **Economy** (`economy.js`): province GDP = population × productivity, productivity =
  400 × 1.06^development ($/person/yr). Monthly tax revenue = taxable GDP × tax rate × efficiency
  (stability-dependent). Civil spending is a share of revenue (raises stability), the remainder
  funds the army; unit upkeep scales with the country's price level. Negative treasury is debt
  with interest. Occupied provinces are not taxable for the owner; occupiers requisition a share.
  Every figure lands in a per-country ledger shown in tooltips.
- **Industry and trade** (`industry.js`, details in ECONOMY.md): per-province building levels and
  deposits (typed arrays), national stockpiles per good, monthly production in data order,
  a world market whose flows are computed from per-exporter and per-importer factors (no pairwise
  loop), world prices from supply/demand, CPI, unemployment, construction queue with slots, and
  army supply. Province GDP = calibrated services + industrial value added, so the start matches
  the scenario and the economy moves it from there.
- **Military** (`military.js`, `pathfind.js`, `combat.js`): armies are stacks of division-type
  units with strength and organisation. A* over the adjacency graph with travel-time costs
  (terrain, province infrastructure, strait/sea-lane penalties, fuel supply for armour) and access rules
  (own, allied, or enemy territory). Battles run for days: damage from unit attack/defence,
  terrain modifiers per unit type, defender terrain and fort bonuses, **combat width** (only part
  of a large stack fights), organisation and bounded randomness. Losers retreat to a friendly
  neighbour or surrender if encircled. Each battle produces a report explaining the outcome.
- **Occupation**: unopposed armies besiege enemy provinces; time scales with fort level and
  development, shrinking with √(units). Liberation of your own/allied land is twice as fast.
- **War & peace** (`war.js`, `relations.js`): declarations break treaties with the target and
  call in its bloc partners, allies, defensive-pact partners, guarantors and subjects; the
  attacker can call its allies to arms. War score = enemy economy you occupy − your economy they occupy + battle results.
  Peace terms (provinces you occupy, reparations, subjugation, independence) cost war score;
co-belligerents can sign a separate peace; white peace is accepted when the other side
  is not clearly winning or the war has dragged on. Truces follow every peace. Countries with no
  provinces are eliminated. A cached relation matrix (hostile, allied, co-belligerent, access flags) answers queries in
  O(1); it is rebuilt when wars, blocs or treaties change.
- **Diplomacy** (`diplomacy.js`, rules in DIPLOMACY.md): treaties are a list of
  `{type, a, b, start, until}` with an incremental index; opinion and trust are computed on demand
  from treaties, blocs, borders, wars, rivals, claims, reputation and a sparse list of decaying
  modifiers, so nothing per-pair is stored. Proposals return a score with reasons that the UI
  shows before you click.
- **Government** (`government.js`, rules in GOVERNMENT.md): `c.govt` holds the ruling faction,
  faction support and approval, legitimacy, policies, election dates and modifiers. Combined
  effects (`govt.fx`) are derived and recomputed on load, not saved.
- **Events** (`events.js`): data-driven domestic events with compiled conditions, player choice
  dialogs and AI weights.
- **AI diplomacy** (`ai_diplomacy.js`): rivals, treaty review, one treaty sought per round,
  embargoes, blocs, influence spending; every decision logged.
- **AI** (`ai.js`): budget management (tax/spending), recruitment within its military budget,
  war declarations against neighbours that need a motive (opinion, rivalry, claims,
  independence) and odds that count both sides' likely joiners, scaled by government war
  propensity and the AI-aggressiveness setting, army planning
  (engage invaders it can beat, finish sieges, take high-value enemy provinces, recover when
  weak, man the border with the strongest neighbour in peacetime), and monthly peace offers
  sized to its war score. Decisions are logged with reasons (AI tab).

## Rendering (`src/map/renderer.js`)

- Geometry → `Path2D` once per province and level of detail; no per-province DOM/scene objects.
- The base layer (fills, coast halo, province and country borders, occupation stripes) is drawn
  into an offscreen cache with a margin. While panning/zooming the cached bitmap is transformed;
  the base re-renders only after the camera settles or when colours change (ownership, map mode).
- Bounding-box culling, fills grouped by colour, a coarse geometry LOD for zoomed-out views and
  fine geometry when zoomed in. Country borders are built from precomputed shared border
  polylines, so changing ownership doesn't need topology work at runtime.
- Picking: uniform grid over province bounding boxes + even-odd point-in-polygon.
- When paused and idle, no animation frames are scheduled at all.

## Map pipeline (`tools/build_map.py`)

Natural Earth admin-1 (4,511 subdivisions) → fill gaps from admin-0 (e.g. South Sudan) →
merge tiny subdivisions per country toward a size target (√area/38 provinces per country) →
split oversized regions (>330,000 km²) → name capital provinces after capital cities →
coverage-preserving simplification at two tolerances (shared borders stay shared) → land
adjacency, short sea straits (≤ ~50 km) and sea lanes that connect every island → coast flags →
terrain estimate → Miller projection, quantised and delta-encoded JSON. Province IDs come from an
append-only registry so they stay stable.

## Saves (`save.js`)

JSON in which every typed array (province fields, building levels, stockpiles) is base64
(~1.1 MB for a modern-world campaign; browser slots are gzip-compressed to ~260–320 KB). Versioned with
step-by-step migrations (`MIGRATIONS[v]`; v2 → v3 installs the scenario's economy into old saves; v3 → v4 installs governments and the
scenario's treaties and blocs; unknown government types or policies fall back to defaults),
validated against the loaded map and rules (unknown countries,
wrong array lengths, missing fields are rejected with a message; removed unit types and invalid
army locations are dropped; a larger newer map extends province arrays). Browser slots use
localStorage with rotation of autosaves; export/import as files works without storage.

## Multiplayer readiness

All player actions go through core functions that validate and return an error string
(`recruit`, `orderMove`, `declareWar`, `makePeace`, …) and the simulation is deterministic, which
is the basis for a lock-step command model later. No networking exists yet.
