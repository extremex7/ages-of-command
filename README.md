# Ages of Command (AOC3)

A map-based grand strategy sandbox inspired by the accessibility of Age of History 2, built to
grow into a deeper historical-to-futuristic simulation. Done so far: the **Milestone 1 build and
"Immediate First Task" prototype** (a real world map, every country playable, a working clock,
armies, war, peace, AI and save/load), **Milestone 3, the economy** (resources, production
chains, construction, infrastructure, a world market with prices, tariffs and embargoes, inflation,
unemployment and army supply) and **Milestone 4, diplomacy and government** (treaties, blocs,
opinion and trust, subjects, richer peace terms, separate peace, government types, factions,
elections, coups, revolutions, policies, domestic events, AI diplomacy) and **Milestone 5,
research and history** (a 119-technology tree across 13 eras, research and diffusion, era units
and modernisation, four historical scenarios from 117 AD to 1962, and 129 dated historical and
world events that need their premises and allow alternate history).

![status](https://img.shields.io/badge/status-prototype-orange)

## Run it

Requirements: any modern browser and **Node.js 18+** (only used as a tiny static file server).
No `npm install` is needed — the game has zero runtime dependencies.

```bash
npm start            # serves the game at http://localhost:8080/
# or: node tools/serve.mjs 8080   (any static server works, e.g. python3 -m http.server)
```

Open the URL, choose **New Game**, pick a scenario (Modern World, Height of Rome 117, The Great
War 1914, The Gathering Storm 1936, The Cold War 1962), then **Choose country**, click a country
and **Play as …**.
Press **Space** to start time. To build, select one of your provinces and use **Build here** in
the province panel; the **Industry** tab shows your goods, trade and construction queue.
Select another country to see your relations with it and propose treaties; the **Government**
tab shows your factions, elections and policies; the **Research** tab sets research spending,
the current project and queue, and opens the technology tree.

> The game must be served over http(s); opening `index.html` from disk will not work because
> browsers block `fetch` of local files.

## Controls

| Input | Action |
| --- | --- |
| Left click | Select province / army (Shift adds armies to the selection) |
| Right click | Move the selected armies (pathfinding picks the route) |
| Drag, arrow keys | Pan · Mouse wheel, `+` `−` zoom |
| `Space` · `1`–`5` | Pause/resume · game speed (1, 3, 8, 20 days/s, max) |
| `P T O V G X K F R Y J Q` | Map modes: political, terrain, population, development, economy, resources, industry, infrastructure, military, diplomacy (opinion), government, technology (era) |
| `N B E U A M D L I` | Tabs: nation, government, economy, industry, research, military, diplomacy, events, AI/performance |
| `C` · `H` | Centre on your capital · show whole world |
| `Ctrl+S` | Quick save · `Esc` clears selection / closes dialogs |

## Test

```bash
npm test                            # 79 unit/integration tests of the simulation (node:test)
npm run bench                       # reproducible 10-year simulation benchmark (seed bench-1)
node tools/bench.mjs 10 1 great_war_1914   # the same for a historical scenario
node tools/smoke.mjs 365 cold_war_1962     # one year of AI play with a summary
node tools/econ_report.mjs 5        # world market and national indicators over 5 years of AI play
npm start &                         # then, with Playwright available:
node tests/browser/e2e.mjs          # boots the game, plays, recruits, moves, builds, uses politics, diplomacy and research, saves, reloads, plays 1914
node tests/browser/bench.mjs        # FPS / memory / sim speed per performance profile
CPU_THROTTLE=4 node tests/browser/bench.mjs   # same, emulating a 4x slower CPU
```

## Rebuild the map and scenario data (optional)

The generated files in `data/` are committed. To regenerate them from source data:

```bash
./tools/fetch_source.sh             # downloads Natural Earth admin-0/admin-1 (public domain) via npm
python3 -m pip install shapely      # Shapely 2.1+ (coverage simplification)
npm run build:map                   # data/map/world.json, data/scenarios/*.json (incl. economy)
npm run build:history               # historical scenarios from tools/history/*.json (no downloads needed)
```

Province IDs are kept stable by `data/map/province_registry.json` (append-only), so saves keep
working across map rebuilds.

## Project layout

```
index.html, styles/        browser entry point and UI styles
src/core/                  simulation (pure JS, no DOM): calendar, rng, mapdata, state, economy,
                           industry (production, market, construction), military, pathfind,
                           combat, war, relations, diplomacy, government, events, technology, ai,
                           ai_diplomacy, sim (clock), save, rules
src/map/                   Canvas 2D renderer, map modes, spatial index / picking
src/ui/                    menus, HUD, panels, dialogs, local save slots
data/map/                  generated world map (2,358 provinces) + stable id registry
data/rules/                units.json, balance.json, goods.json, buildings.json, governments.json, technologies.json — editable game rules
data/events/               domestic, world and historical events + index.json
data/scenarios/            scenario files + index.json
tools/                     map/scenario/economy pipeline, history/ scenario definitions + build_history.mjs, dev server, benchmark, economy report
tests/                     node:test suites; tests/browser/ Playwright end-to-end + benchmark
docs/                      ARCHITECTURE, ECONOMY, DIPLOMACY, GOVERNMENT, TECHNOLOGY, SCENARIOS, FEATURES (checklist), DEVLOG,
                           PERFORMANCE, MODDING
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — stack decision and system design
- [docs/ECONOMY.md](docs/ECONOMY.md) — every economic rule and formula
- [docs/DIPLOMACY.md](docs/DIPLOMACY.md) — opinion, treaties, blocs, peace terms, AI diplomacy
- [docs/GOVERNMENT.md](docs/GOVERNMENT.md) — government types, factions, elections, coups, policies, events
- [docs/TECHNOLOGY.md](docs/TECHNOLOGY.md) — technology tree, research formulas, eras, unit and building gating
- [docs/SCENARIOS.md](docs/SCENARIOS.md) — the historical scenarios, how they are built, historical events
- [docs/FEATURES.md](docs/FEATURES.md) — implemented / partial / planned checklist and the continuation plan
- [docs/PERFORMANCE.md](docs/PERFORMANCE.md) — measured numbers and how to reproduce them
- [docs/MODDING.md](docs/MODDING.md) — data formats for units, balance, goods, buildings, governments, events and scenarios
- [docs/DEVLOG.md](docs/DEVLOG.md) — development log

## Data sources and honesty notes

- Borders: Natural Earth 1:10m admin-1 and 1:50m admin-0, v5.1.2 — public domain. Modern
  boundaries follow Natural Earth's UN point of view.
- Country population/GDP: rounded c. 2025 estimates. Their split across provinces, the terrain
  map and starting armies are **model estimates**, labelled as such in-game.
- Resource shares and industrial specialisations (`tools/resource_table.csv`) are rounded public
  estimates used as balance inputs; deposits and starting industry per province are generated.
- Flags are simplified patterns, not accurate artwork.
- Historical scenarios: borders are approximated with modern admin-1 provinces; population, GDP
  and army figures are rounded Maddison-style estimates including colonies. Each scenario lists
  its approximations on the New Game screen and in [docs/SCENARIOS.md](docs/SCENARIOS.md).
