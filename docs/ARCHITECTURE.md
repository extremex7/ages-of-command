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
- **Rules** (`data/rules/*.json`): unit stats, balance constants, goods, buildings, governments
  and technologies, validated on load (`rules.js`, `technology.js`).
- **Sea zones** (`map.sea`, decoded by `mapdata.js` from `data/map/seas.json`): 99 zones, zone
  links in CSR form (`start/adj/km/link`) with chokepoints and canal years, the zones of each
  coastal province (`portStart/portZones`, and `zoneProvs` the other way), the zone each strait
  or sea lane crosses (`laneZone`, per province-graph edge) and the 0.5° zone grid for picking.
  Path nodes ≥ `map.count` stand for sea zones (`map.count + zone`) in army paths.

## Simulation clock (`sim.js`)

Order of one tick since Milestone 6:

| Step | Daily | Monthly (1st of the month, after the AI) |
| --- | --- | --- |
| 1 | `processRecruitment` (land units join armies, ships fleets, aircraft wings) | `navalTrade` (blockade and raiding → trade factor) |
| 2 | `processMovement` (armies, including at sea) | `strategicBombing` |
| 3 | `processFleets` (sailing, docking, repair) | `monthlyEconomy` (production, market, budget) |
| 4 | `processWings` (lost bases, repair) | `monthlyStrategic` (warheads, missiles, cyber, space, debris, winter, strategic AI) |
| 5 | `detectBattles`, `detectNavalBattles` | `monthlyDepots` (lost depots) |
| 6 | `dailySupply` (supply levels, attrition) | `monthlyResearch` |
| 7 | `resolveBattles` (with air and naval support), `resolveNavalBattles` | `monthlyMilitary` (reinforcement) |
| 8 | `processSieges`, `dailyRecovery` | war scores, `monthlyGovernment`, `monthlyDiplomacy`, `monthlyDeals` |
| 9 | `dailyStrategic` (queued retaliation strikes) | `aiPeace`, `aiEconomy`, `monthlyNations` (traits, advisors, formable nations, missions) |
| 10 | `processConstruction`, `dailyEvents` | `refreshCountryCache` |
| 11 | `aiTick` (incl. fleets; wings and depots about every 28 days), `aiDiplomacy` | |

In words: one tick = one day. Daily: recruitment, movement, battle detection/resolution, sieges,
organisation recovery, construction, events (each country checked once a month, spread across
days; events queued by a `trigger` run the next day), AI diplomacy (each country every 3 months, spread across days). AI military: each country thinks every 7 days, staggered by country index so ~1/7
of countries run per tick. Monthly (1st of month): production, world market, consumption and
their effects, budget, research (points, project completion, AI project choice), reinforcement, war scores, government (approval, legitimacy, elections,
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
- **Events** (`events.js`): data-driven domestic, world and historical events with compiled
  conditions, date windows, scenario and country filters, chains (`trigger`), player choice
  dialogs and AI weights; history effects can declare war, annex, transfer and release land,
  change governments, sign treaties and grant technologies (SCENARIOS.md).
- **Technology** (`technology.js`, rules in TECHNOLOGY.md): known technologies are one byte per
  country and technology (`state.tech.known`, saved with the id list). Everything they imply —
  normalised effect multipliers, unlocked goods, buildings and units, waived building inputs and
  the era — lives in `c.tfx`, derived and rebuilt on load. Research is monthly; the diffusion
  discount uses neighbour sets and a per-day cached world GDP share per technology.
- **Navies** (`naval.js`, rules in NAVY_AIR.md): fleets (`state.fleets`) sail between zones and
  dock in ports; per-zone presence and control are derived once a day (cached on `state.day` and
  a fleet version counter, never saved). Naval battles (`state.navalBattles`), submarine
  detection, blockades and raiding, chokepoints and canals. Armies at sea (`a.sea`) and the
  sea-aware pathfinder (`findSeaPath` in `pathfind.js`) live in `military.js`/`pathfind.js`.
- **Air** (`air.js`): wings (`state.wings`) at base provinces with a range and a mission; air
  combat and close air support feed `combat.js`; monthly strategic bombing.
- **Logistics** (`supply.js`, rules in LOGISTICS.md): per-country supply maps by flood fill,
  quantised to bytes and kept in `state.supplyCache` (saved, for deterministic reloads); daily
  army supply and attrition; depots.
- **Strategic** (`strategic.js`, rules in STRATEGIC.md): `c.strat` per country and
  `state.strategic` for the world: nuclear programmes, delivery, interception, strikes and
  retaliation, nuclear winter and fallout, cyber operations, satellites, ASAT and debris, space
  projects, and the strategic AI (run inside `monthlyStrategic`).
- **Nations** (`nations.js`, `advisors.js`, `missions.js`, `natfx.js`; rules in NATIONS.md): traits,
  formable nations, advisors and missions per country, all optional in saves. Their combined
  bonuses are derived (`natfx.js`) and folded into `govt.fx` and `tfx` when those are rebuilt.
- **AI diplomacy** (`ai_diplomacy.js`): rivals, treaty review, one treaty sought per round,
  embargoes, blocs, influence spending; every decision logged.
- **Deals** (`deals.js`, AI in `ai_deals.js`, rules in DIPLOMACY.md): loans, ultimatums, personal
  unions (a treaty type), province sales and gifts, money gifts and rebel funding. Its lists
  (`state.dip.loans`, `support`, `pending`, `cbs`) are created lazily, so older saves load as they
  are; monthly work is one pass over those short lists, and the AI's deals run in its staggered
  diplomacy round.
- **AI** (`ai.js`): budget management (tax/spending), recruitment within its military budget,
  war declarations against neighbours that need a motive (opinion, rivalry, claims,
  independence) and odds that count both sides' likely joiners, scaled by government war
  propensity and the AI-aggressiveness setting, army planning
  (engage invaders it can beat, finish sieges, take high-value enemy provinces, recover when
  weak, man the border with the strongest neighbour in peacetime), and monthly peace offers
  sized to its war score. Decisions are logged with reasons (AI tab). Since Milestone 6 it also
  splits recruitment between land, sea and air by target upkeep shares, moves fleets and wings,
  places depots, and will not attack a nuclear power without a deterrent of its own.

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

## Historical scenario pipeline (`tools/build_history.mjs`)

Scenario definitions in `tools/history/` list countries with region rules over the shared
admin-1 map; the builder resolves ownership (later rules override earlier ones), spreads
population and GDP, derives development, places era-appropriate armies within an upkeep cap and
writes diplomacy, wars and the provinces dormant countries would get when released. The economy
builder then seeds industry, copying deposits from the Modern World and placing only buildings
each owner has the technology for. All scenarios share one map, so province ids, the renderer and
saves need nothing scenario-specific.

## Sea zone pipeline (`tools/build_seas.py`)

Natural Earth 50m land → 0.5° water grid → 99 zones grown from hand-placed seeds by sailing
distance → links from touching cells plus hand-listed straits and canals (chokepoint provinces,
opening years) → each coastal province's zones → the zone of each strait and sea lane → the
run-length encoded grid. Details in NAVY_AIR.md.

## Forces pipeline (`tools/build_forces.mjs`)

`tools/forces/<id>.csv` (real counts) → units of the newest type per role at each country's
technology year, capped by upkeep → fleets in its largest ports, missile submarines at sea, air
wings at the capital and largest cities, warheads, missiles and satellites written into the
scenario. `tools/build_history.mjs` runs it for every scenario with a table. Details in
tools/forces/README.md.

## Saves (`save.js`)

JSON in which every typed array (province fields, building levels, stockpiles) is base64
(~1.1 MB for a modern-world campaign; browser slots are gzip-compressed to ~260–320 KB). Versioned with
step-by-step migrations (`MIGRATIONS[v]`; v2 → v3 installs the scenario's economy into old saves; v3 → v4 installs governments and the
scenario's treaties and blocs; v4 → v5 installs the scenario's starting technologies; v5 → v6 adds empty
fleets, wings, naval battles, strategic capabilities and depots, and puts every army on land; unknown
government types or policies fall back to defaults and a changed technology file is remapped by id),
validated against the loaded map and rules (unknown countries,
wrong array lengths, missing fields are rejected with a message; removed unit types and invalid
army locations are dropped; a larger newer map extends province arrays). Browser slots use
localStorage with rotation of autosaves; export/import as files works without storage.

## The bot (automated players)

`c.automate` hands a human country to the AI: `humanControls(state, k)` is false, so every AI
system runs it and nothing is queued for it. `src/core/automate.js` turns it on and off and
answers whatever was already waiting (`settlePending`); a per-country `c.aiProfile`
(`aiTemper` in ai.js) replaces the game's AI aggression and difficulty for that country only
and lets it start wars. The bot (`src/bot/`, docs/BOT.md) uses this from a separate window
(`bot.html`, the simulation in a Web Worker) or the command line (`tools/autoplay.mjs`): it
loads a save, plays it in slices, and writes saves with the country handed back. On the desktop
the game re-reads the slot list and saves from disk (`syncSlots`, `readSave` in storage.js),
since the bot window writes the same store.

## Multiplayer

**Hotseat** (`hotseat.js`, interface in `src/ui/hotseat_ui.js`): two to eight humans at one
computer, each leading a country. `state.hotseat` (absent in single player, so old saves and
single-player games are unchanged) holds the players `{ k, name, seq, record, civil, out }`, the
mode, how long a round runs, whose turn it is, the stage and the round. `state.player` stays "the
human at the screen": the active player in their turn, -1 between turns and while a round runs,
so the interface needed no changes to show one player's view. The simulation instead asks
`isHuman(state, k)` / `humanControls(state, k)` (state.js), true for every player's country:
the AI skips them (military, economy, diplomacy, research, policies, spies, strategic forces),
their events and proposals wait for them, and AI peace offers go to them as offers.

- Taking turns: stage `handover` (a cover hides the map until the named player confirms) →
  `plan` (time cannot run; End turn) → the next player's handover → `ready` (choose a week, a
  month, or until the next event) → `run` → the first player's handover. "Until the next event"
  stops at a new event or offer for a player, a player's civil war, or a new war involving a
  player (or after a year). Events and offers to a player who has not seen them do not expire;
  their 30 days start when that player's turn begins (`p.seen`, `o.seen`). A loaded game never
  reopens a turn without the handover screen.
- Shared screen: time runs as in single player; F2 or the top-bar button gives the controls to
  the next player, and a decision for another player switches to them first.
- Log entries can belong to one player (`who`, written by `logFor`) and `important` can be the
  list of players it matters to (`impFor`); in single player both behave exactly as before.
  Each player's turn opens with their news since their last turn; the Events tab and the
  notifications show only what that player may see. While a round runs only public news shows.
- Peace demands and separate peace requests to a human leader become offers (`offerToHuman`),
  answered in the Diplomacy tab in their turn; treaty proposals already worked that way.
- Records (summary) per player; no achievements. A player whose country is annexed is out and
  skipped; the game ends when every player is out.

**Online**: all player actions go through core functions that validate and return an error
string (`recruit`, `orderMove`, `declareWar`, `makePeace`, …) and the simulation is
deterministic, which is the basis for a lock-step command model later. No networking exists yet.
