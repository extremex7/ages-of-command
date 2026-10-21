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

**Milestone 6, navies, air, logistics and strategic weapons:** navies on 99 sea zones derived from
the coastline (fleets, naval battles, submarines, carriers, sea control, blockades and commerce
raiding, chokepoints and canals, armies carried by sea), air wings (air superiority, close air
support, strategic bombing, interceptors), supply lines with depots and attrition, and strategic
capabilities (nuclear programmes, delivery, missile defence, retaliation, deterrence in AI war
decisions, arms control, nuclear winter, cyber operations, satellites, anti-satellite weapons and
fictional space projects), with starting forces for every scenario and two speculative-fiction
scenarios, Flashpoint 2035 and Orbital Age 2085. The interface has fleet and air-wing cards with
map orders, a Strategic tab, a nuclear strike confirmation, depots, and Naval and Supply map
modes. What is still missing is listed in [docs/FEATURES.md](docs/FEATURES.md).

![status](https://img.shields.io/badge/status-prototype-orange)

## Run it

**Easiest (Windows):** run `AgesOfCommand-<version>-windows-setup.exe`. It installs for your user
only (no administrator rights), adds Start menu and desktop shortcuts, and the game opens in its
own window (Windows' built-in WebView2 engine; no browser needed). Saves are kept in
`%APPDATA%\AgesOfCommand`. Prefer no install? Unzip `AgesOfCommand-<version>-windows-portable.zip`
and run `AgesOfCommand.exe`. Linux (native window too) and macOS packages work the same way.

**Android:** install `AgesOfCommand-<version>-android.apk` on the phone (allow installing from
your file manager when asked). Drag to move the map, pinch to zoom, tap to select, press and hold
to give an order. See [android/README.md](android/README.md).

Build them all with `tools/build_desktop.sh`; see [launcher/README.md](launcher/README.md).

From source: any modern browser and **Node.js 18+** (only used as a tiny static file server).
No `npm install` is needed — the game has zero runtime dependencies. On Windows, `start.bat`
does the same as `npm start`.

```bash
npm start            # serves the game at http://localhost:8080/
# or: node tools/serve.mjs 8080   (any static server works, e.g. python3 -m http.server)
```

**Hotseat:** on the New Game screen choose 2 to 8 players and their names; each picks a country,
the rest are AI. By default the players take turns: a handover screen hides the map until the
next player sits down, each plans with time paused and presses **End turn**, and once everyone
has planned the game runs for a week, a month or until the next event. Or share the screen and
switch country with **F2** while time runs.

Open the URL, choose **New Game**, pick a scenario (Modern World, Height of Rome 117, Rise of
Empires 1444, Concert of Europe 1815, A House Divided 1861, The Great War 1914, The Gathering Storm 1936, The Cold War 1962, or the fictional Flashpoint 2035 and
Orbital Age 2085), then **Choose country**, click a country
and **Play as …**.
Press **Space** to start time. To build, select one of your provinces and use **Build here** in
the province panel; the **Industry** tab shows your goods, trade and construction queue.
Select another country to see your relations with it and propose treaties; the **Nation** tab
also shows your national traits, the nations you can form and your objectives; the **Government**
tab shows your factions, elections, policies and advisors; the **Research** tab sets research spending,
the current project and queue, and opens the technology tree. In the **Military** tab, switch
between Army, Navy and Air to build warships and aircraft; the **Strategic** tab handles nuclear
programmes, cyber operations, satellites and space.

> The game must be served over http(s); opening `index.html` from disk will not work because
> browsers block `fetch` of local files.

## Controls

| Input | Action |
| --- | --- |
| Left click | Select province / army / fleet / air wing (Shift adds to the selection) |
| Right click | Move the selected armies (by land or sea); sail fleets to a sea zone or dock them in a friendly port; rebase wings to a province |
| Drag, arrow keys | Pan · Mouse wheel, `+` `−` zoom |
| `Space` · `1`–`5` | Pause/resume · game speed (1, 3, 8, 20 days/s, max) |
| `P T O V G X K F R Y J Q S W` | Map modes: political, terrain, population, development, economy, resources, industry, infrastructure, military, diplomacy (opinion), government, technology (era), naval (sea control), supply |
| `N B E U A M Z D L I` | Tabs: nation, government, economy, industry, research, military, strategic, diplomacy, events, AI/performance |
| `C` · `H` | Centre on your capital · show whole world |
| `Ctrl+S` | Quick save · `Esc` clears selection / closes dialogs · `F11` full screen · `F2` next player (hotseat, shared screen) |
| `Tab` or `\` · `` ` `` | Hide or show the side panel · cheat console (only when cheats are enabled) |
| `Enter` · `Shift+Enter` | Select the province in the middle of the map · send the selected forces there |
| `[` · `]` | Previous · next of your armies, fleets and air wings |
| Touch | Drag to pan, pinch to zoom, tap to select, press and hold to order |

**Settings** (main menu, or Menu → Settings in a game) apply at once: window mode (windowed,
maximised, full screen) and window size in the desktop app, interface scale (Auto fits the
window), graphics quality, map resolution, a frame rate limit, whether the game resumes after an
event decision (it does by default), music and sound effect volumes, the tutorial (ask, always or off), cheats, tooltips and autosaves.
**Accessibility** settings: colour vision (map modes and interface colours for red-green or
blue-yellow colour blindness), text size (up to 150%, with panels kept the same width), and
keyboard-only play (Tab moves between buttons and lists, any clickable row can be pressed with
Enter, a cross marks the middle of the map for `Enter` and `Shift+Enter`). **Exit** on the main menu closes
the desktop and Android apps.

## Test

```bash
npm test                            # 203 unit/integration tests of the simulation (node:test)
npm run bench                       # reproducible 10-year simulation benchmark (seed bench-1)
node tools/bench.mjs 10 1 great_war_1914   # the same for a historical scenario
node tools/smoke.mjs 365 cold_war_1962     # one year of AI play with a summary
node tools/econ_report.mjs 5        # world market and national indicators over 5 years of AI play
npm start &                         # then, with Playwright available:
node tests/browser/e2e.mjs          # boots the game, plays, recruits, moves, builds, uses politics, diplomacy and research, saves, reloads, plays 1914
node tests/browser/m6.mjs           # Milestone 6 interface: navies, air wings, supply, Strategic tab
node tests/browser/clicks.mjs       # tab and build presses while time runs
node tests/browser/settings.mjs     # display settings
node tests/browser/flags.mjs        # every scenario's flags load; the game resumes after an event decision
node tests/browser/techtree.mjs     # top-bar points, technology tree (pan, zoom, pinch, queue), music moods and sound settings
node tests/browser/session10.mjs    # side panel toggle, leaderboard, tutorial, cheats
node tests/browser/features2.mjs    # generals, battle plans, the civil-war choice, intelligence, the world council
node tests/browser/editor.mjs       # scenario editor: paint a new country, save, play, reload
node tests/browser/access.mjs       # colour-blind colours, text size, keyboard-only play
node tests/browser/summary.mjs      # achievements and the game summary
node tests/browser/hotseat.mjs      # hotseat: two players pick, plan, hand over, run a week; shared screen
node tests/browser/deals.mjs        # diplomacy deals: loans, ultimatums, unions, rebel funding, offers to the player
node tests/browser/nations.mjs      # traits, forming a nation, objectives and advisors
node tests/browser/session23.mjs    # victory, capitulation, experience, bulk construction, colonies
node tests/browser/bench.mjs        # FPS / memory / sim speed per performance profile
CPU_THROTTLE=4 node tests/browser/bench.mjs   # same, emulating a 4x slower CPU
```

## Rebuild the map and scenario data (optional)

The generated files in `data/` are committed. To regenerate them from source data:

```bash
./tools/fetch_source.sh             # downloads Natural Earth admin-0/admin-1 (public domain) via npm
python3 -m pip install shapely      # Shapely 2.1+ (coverage simplification)
npm run build:map                   # world.json, seas.json, the Modern World scenario (economy, diplomacy, forces)
npm run build:seas                  # only data/map/seas.json (sea zones; needs the Natural Earth download)
npm run build:history               # scenarios from tools/history/*.json, with forces and economy (no downloads needed)
npm run build:forces                # only the starting navies, air forces and strategic forces from tools/forces/*.csv
python3 tools/build_flags.py <flag-icons dir> <i18n-iso-countries dir>   # data/flags/ (npm pack both, then unpack)
node tools/build_icons.mjs <lucide-static dir>                             # src/ui/icons.js
```

Province IDs are kept stable by `data/map/province_registry.json` (append-only), so saves keep
working across map rebuilds.

## Project layout

```
index.html, styles/        browser entry point and UI styles
src/core/                  simulation (pure JS, no DOM): calendar, rng, mapdata, state, economy,
                           industry (production, market, construction), military, pathfind,
                           combat, naval, air, supply, strategic, war, relations, diplomacy,
                           government, events, technology, ai, ai_diplomacy, hotseat, sim (clock), save, rules
src/map/                   Canvas 2D renderer, map modes, spatial index / picking
src/ui/                    menus, HUD, panels, dialogs, save slots (browser storage, or disk in the desktop app)
launcher/                  desktop launcher (Go; native window), Windows installer script, icon
android/                   Android app (one Java activity around the system WebView)
data/map/                  generated world map (2,358 provinces), sea zones (seas.json) + stable id registry
data/rules/                units.json, balance.json, goods.json, buildings.json, governments.json, technologies.json,
                           formables.json, traits.json, nations.json — editable game rules
data/events/               domestic, world, historical, strategic and future-scenario events + index.json
data/scenarios/            scenario files + index.json
tools/                     map/seas/scenario/economy pipeline, history/ scenario definitions + build_history.mjs,
                           forces/ starting-force tables + build_forces.mjs, dev server, benchmark, economy report
tests/                     node:test suites; tests/browser/ Playwright end-to-end + benchmark
docs/                      ARCHITECTURE, ECONOMY, DIPLOMACY, GOVERNMENT, TECHNOLOGY, SCENARIOS, NAVY_AIR, LOGISTICS,
                           STRATEGIC, FEATURES (checklist), DEVLOG, PERFORMANCE, MODDING
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — stack decision and system design
- [docs/ECONOMY.md](docs/ECONOMY.md) — every economic rule and formula
- [docs/DIPLOMACY.md](docs/DIPLOMACY.md) — opinion, treaties, blocs, peace terms, sanctions, the world council, deals (loans, ultimatums, personal unions, land sales, rebel support), AI diplomacy
- [docs/GOVERNMENT.md](docs/GOVERNMENT.md) — government types, factions, elections, coups, policies, events
- [docs/TECHNOLOGY.md](docs/TECHNOLOGY.md) — technology tree, research formulas, eras, unit and building gating
- [docs/SCENARIOS.md](docs/SCENARIOS.md) — the historical scenarios, how they are built, historical events
- [docs/NAVY_AIR.md](docs/NAVY_AIR.md) — sea zones, fleets, naval combat, blockades, amphibious movement, air wings, bombing
- [docs/MILITARY.md](docs/MILITARY.md) — generals and battle plans (fronts, attack arrows)
- [docs/LOGISTICS.md](docs/LOGISTICS.md) — supply network, attrition, depots
- [docs/ESPIONAGE.md](docs/ESPIONAGE.md) — spy networks, stealing technology, sabotage, coups and puppets
- [docs/STRATEGIC.md](docs/STRATEGIC.md) — nuclear weapons and deterrence, cyber, satellites, space
- [docs/ACHIEVEMENTS.md](docs/ACHIEVEMENTS.md) — achievements and the game summary
- [docs/NATIONS.md](docs/NATIONS.md) — formable nations, national traits, advisors and missions
- [docs/FEATURES.md](docs/FEATURES.md) — implemented / partial / planned checklist and the continuation plan
- [docs/PERFORMANCE.md](docs/PERFORMANCE.md) — measured numbers and how to reproduce them
- [docs/MODDING.md](docs/MODDING.md) — data formats for units, balance, goods, buildings, governments, events, sea zones, forces and scenarios
- [launcher/README.md](launcher/README.md) — the desktop launcher, installer and packages
- [android/README.md](android/README.md) — the Android app
- [docs/DEVLOG.md](docs/DEVLOG.md) — development log

## Data sources and honesty notes

- Borders: Natural Earth 1:10m admin-1 and 1:50m admin-0, v5.1.2 — public domain. Modern
  boundaries follow Natural Earth's UN point of view.
- Country population/GDP: rounded c. 2025 estimates. Their split across provinces, the terrain
  map and starting armies are **model estimates**, labelled as such in-game.
- Resource shares and industrial specialisations (`tools/resource_table.csv`) are rounded public
  estimates used as balance inputs; deposits and starting industry per province are generated.
- Flags: present-day flags from [flag-icons](https://github.com/lipis/flag-icons) (MIT,
  `data/flags/LICENSE-flag-icons.txt`). Historical flags are drawn by `tools/build_flags.py`;
  several are simplified, listed under `notes` in `data/flags/index.json`. Ancient states and
  the invented unions of 2085 have stylised pattern flags.
- Icons: [Lucide](https://lucide.dev) (ISC licence, `src/ui/LICENSE-lucide.txt`), generated into `src/ui/icons.js`.
- Historical scenarios: borders are approximated with modern admin-1 provinces; population, GDP
  and army figures are rounded Maddison-style estimates including colonies. Each scenario lists
  its approximations on the New Game screen and in [docs/SCENARIOS.md](docs/SCENARIOS.md).
- Starting navies, air forces, warheads and satellites (`tools/forces/*.csv`) are rounded public
  figures (IISS, SIPRI and fleet lists), capped by an upkeep rule.
- **Flashpoint 2035 and Orbital Age 2085 are speculative fiction.** Their borders changes,
  populations, economies, forces, events and the technologies flagged `fictional` are invented to
  make a playable future, not forecasts.
