# Feature checklist

Legend: ✅ implemented (simulation + UI + tests where it matters) · 🟡 partial · ⬜ planned.
Nothing is marked ✅ if it is only a placeholder.

## Immediate first task (prototype)

| Feature | Status | Notes |
| --- | --- | --- |
| Real, simplified province map | ✅ | 2,358 provinces from Natural Earth admin-1 |
| Multiple playable countries | ✅ | All 196 countries in the Modern World scenario |
| Province ownership and selection | ✅ | Hover, click, search, province panel |
| Working date and turn system | ✅ | Daily ticks, pause, 5 speeds |
| Basic country information panels | ✅ | Nation tab, province panel, top bar |
| Basic economy (income, expenses, treasury) | ✅ | GDP-based tax, civil spending, upkeep, debt |
| Army recruitment and movement | ✅ | 3 unit types, training time, A* movement |
| Basic war and combat | ✅ | Multi-day battles, retreat, encirclement, reports |
| Simple AI countries | ✅ | Budget, recruitment, war, armies, peace |
| Save and load | ✅ | Slots, autosave rotation, export/import, migration |

## Milestone 1 — playable foundation

| Feature | Status | Notes |
| --- | --- | --- |
| Project initialised, run instructions | ✅ | README |
| Main menu and new-game screen | ✅ | Scenario, difficulty, AI aggressiveness, seed |
| Country and province selection | ✅ | |
| Clock, pause, simulation speed | ✅ | |
| Country data, ownership, country switching | ✅ | Pick at start, observe, or switch any time from the Nation tab |
| Country and province information | ✅ | |
| Save/load | ✅ | |
| Settings: performance profiles, UI scale, autosave | ✅ | |
| Keyboard shortcuts, tooltips | ✅ | |

## Milestone 2 — core strategy

| Feature | Status | Notes |
| --- | --- | --- |
| Movement between connected provinces | ✅ | Land, straits, sea lanes; since Milestone 6 also by sea through sea zones, and crossings close when enemy fleets hold the water |
| Armies, recruitment, movement, combat | ✅ | Merge / split / stop |
| War declarations, occupation, peace | ✅ | Alliances join defensively; truces |
| Basic country AI, military interface | ✅ | |
| Separate peace for non-leaders | ⬜ | Only war leaders negotiate |
| Fronts, battle plans, commanders | ⬜ | |

## Milestone 3 — economy

See [ECONOMY.md](ECONOMY.md) for every formula.

| Feature | Status | Notes |
| --- | --- | --- |
| Taxation, budget, debt, tariffs | ✅ | Tariff revenue in the ledger; tariff slider |
| Population growth tied to food | ✅ | Hunger slows or reverses growth |
| Development growth | ✅ | Driven by living standard and civil spending |
| 14 goods: food, timber, coal, oil, iron, uranium, rare earths, steel, energy, fuel, consumer goods, electronics, machinery, munitions | ✅ | Data-driven (`goods.json`) |
| Resource deposits per province | ✅ | Sized from real production shares; resources map mode |
| 15 building types with inputs, outputs, workforce, deposits, farmland | ✅ | Data-driven (`buildings.json`) |
| National stockpiles and shortages | ✅ | Shortages hit GDP, stability, unemployment, prices, armies |
| Workforce and unemployment | ✅ | Industrial workforce per province; idle workers counted |
| Infrastructure | ✅ | 0–10 per province; building efficiency and movement speed |
| Construction queue with slots, goods and refunds | ✅ | Province panel build menu; Industry tab queue |
| World market, prices, imports/exports | ✅ | Automatic each month; prices follow world supply and demand |
| Embargoes; war closes trade | ✅ | Player embargo button; AI embargoes since Milestone 4 |
| Inflation / CPI and price level | ✅ | CPI raises unit, upkeep and construction costs |
| Army supply (munitions, fuel) | ✅ | Shortages weaken combat and slow armour; shown in battle reports |
| AI investment | ✅ | Builds against its largest shortfalls; logs reasons |
| Economic reports and calculation tooltips | ✅ | Indicators, budget, stability drivers, 24-month charts, per-good breakdown |
| Trade agreements, tariffs per partner, AI sanctions | ✅ | Added in Milestone 4: trade treaties and economic blocs waive tariffs; AI embargoes |
| Gas/hydro/renewable power, transport costs, regional markets | ⬜ | Folded into simpler rules (see ECONOMY.md) |

## Milestone 4 — diplomacy and government

See [DIPLOMACY.md](DIPLOMACY.md) and [GOVERNMENT.md](GOVERNMENT.md).

| Feature | Status | Notes |
| --- | --- | --- |
| Opinion, trust, reputation, influence | ✅ | Computed with full breakdown tooltips; decaying modifiers |
| Treaties: alliance, defensive pact, NAP, military access, guarantee, trade agreement | ✅ | Proposals scored with visible reasons; limits, minimum duration, breaking penalties |
| Subjects (vassals) with tribute; independence wars | ✅ | Created in peace treaties |
| Organisations: defence and economic blocs, membership votes | ✅ | NATO, CSTO, EU, Mercosur, EAEU, GCC; apply/leave in the Diplomacy tab |
| Allies join wars; calls to arms | ✅ | Declare dialog previews joiners and costs |
| Peace terms: reparations, subjugation, independence, claims | ✅ | Plus separate peace for co-belligerents |
| Rivals | ✅ | Player and AI; affect opinion and justification |
| Government types (8), families, effects | ✅ | Tax efficiency, manpower, construction, stability, war propensity |
| Factions, approval, support, legitimacy | ✅ | Government tab with per-faction breakdown |
| Elections | ✅ | Democracies; ruling faction changes |
| Coups and revolutions | ✅ | Change the government type |
| Policies (5 groups) and government reform | ✅ | |
| Domestic events (17, data-driven) | ✅ | Conditions, choices, modifiers; player dialog, AI choice |
| AI diplomacy: rivals, treaties, embargoes, blocs, influence | ✅ | Reasons logged in the AI tab |
| AI peace negotiation with the new terms | ✅ | |
| Diplomacy and government map modes | ✅ | Keys `y` and `j` |
| The player voting on bloc applicants | 🟡 | The player's vote is cast automatically by opinion, like the AI's |
| Sanctions short of a full embargo, international votes (UN-style) | ⬜ | |
| Civil wars (a country splitting) | ⬜ | Revolutions change the government in place |
| Espionage, demilitarised zones, ceasefires, puppet governments by coup | ⬜ | |
| AI reforming its own government type | ⬜ | AI changes policies only |

## Milestone 5 — research, eras and historical scenarios

See [TECHNOLOGY.md](TECHNOLOGY.md) and [SCENARIOS.md](SCENARIOS.md).

| Feature | Status | Notes |
| --- | --- | --- |
| Technology tree with prerequisites (data file) | ✅ | 119 technologies, 13 eras from Ancient to Future, 13 fields; 13 speculative technologies (132 and 17 after Milestone 6) |
| Meaningful effects | ✅ | Farm, mine and industrial output, research, growth, combat, movement, siege, tax, construction; normalised so the 2026 balance is unchanged |
| Research: spending, points, queue, diffusion | ✅ | Budget line; √ spending × education; neighbours and world adoption cut costs up to 65%; banking and switching rules |
| Era progression | ✅ | Era from known technologies; sets mobilisable manpower; shown in the top bar, Nation tab and Technology map mode |
| Era units and modernisation | ✅ | 11 units from levies to armour, gated by technology; Modernise button; the AI fields its newest units |
| Goods and buildings gated by technology | ✅ | No demand for unknown goods; unknown inputs waived; buildings need their technology |
| Research tab and technology tree overlay | ✅ | Era × field grid with tooltips (cost breakdown, effects, unlocks); click to queue with prerequisites |
| AI research | ✅ | Value ÷ cost weighted by current needs; logged |
| Reusable historical scenario loader | ✅ | Region-rule definitions → scenario files (`tools/build_history.mjs`), economy seeded per scenario |
| Playable historical scenarios | ✅ | Height of Rome (117), The Great War (1914), The Gathering Storm (1936), The Cold War (1962) |
| Dormant countries released by events | ✅ | 34 across the scenarios (Poland 1914, the Soviet republics 1962…) |
| Historical events with date and condition triggers | ✅ | 114 historical + 15 world events; premises in conditions, chains via `trigger`, once-only |
| Alternate history, events not forced | ✅ | Historical / Plausible / Off setting; every option possible; events skip when their premise fails |
| Starting wars, subjects, blocs and policies from the scenario | ✅ | |
| Save v5 with migration; tech file remapping | ✅ | |
| Scenario editor UI | ⬜ | Scenarios are JSON definitions plus the builder |
| Colonisation of unowned land | ⬜ | Unowned land is impassable in Height of Rome |
| Technology trading / espionage | ⬜ | Diffusion models spread instead |
| Navy, air and space technologies with their own systems | ✅ | Done in Milestone 6: they unlock ships, aircraft, warheads, satellites and space projects |
| More scenarios (e.g. 1444, 1815, 1861) | ⬜ | The format supports any date; each needs a definition file and events |

## Milestone 6 — navies, air forces, logistics and strategic capabilities

See [NAVY_AIR.md](NAVY_AIR.md), [LOGISTICS.md](LOGISTICS.md) and [STRATEGIC.md](STRATEGIC.md).

| Feature | Status | Notes |
| --- | --- | --- |
| Sea zones from the coastline | ✅ | 99 zones, 200 links, ports for 986 provinces, 0.5° zone grid (`tools/build_seas.py`) |
| Chokepoints and canals | ✅ | 8 straits and canals; Suez opens 1869, Panama 1914; closed to enemies of the controller |
| Fleets: build, sail, dock, repair, merge, split | ✅ | 16 ship types in 6 roles from galleys to (fictional) railgun cruisers |
| Naval battles with reports | ✅ | Daily exchange, sinking, retreat to port, war score |
| Submarines, detection and commerce raiding | ✅ | Stealth vs anti-submarine search; raiding cuts trade |
| Sea control and blockades | ✅ | Monthly trade factor from blockade and raiding |
| Carriers and naval bombardment | ✅ | Carrier aviation in naval and land battles; shore bombardment eases landings |
| Amphibious movement | ✅ | Embark, sail, land; transports sunk in hostile waters |
| Air wings, bases, range, missions | ✅ | 12 aircraft types in 4 roles; superiority, support, bombing, idle |
| Air combat and close air support in land battles | ✅ | Air share decides how much ground attack gets through |
| Strategic bombing and interceptors | ✅ | Monthly; stealth bombers are harder to intercept |
| AI navies and air forces | ✅ | Force mix by upkeep share, fleet hunting and blockades, wing missions and rebasing |
| Supply network, attrition, crowding | ✅ | Per-country flood fill, sea supply, effects on combat, organisation, reinforcement |
| Supply depots (player and AI) | ✅ | Limit by GDP, cost by price level |
| Nuclear programmes, warheads, missiles | ✅ | Five programme levels; uranium and money |
| Delivery, interception, missile defence | ✅ | Missiles, missile submarines, bombers; defence, warning satellites, hypersonics |
| Nuclear strikes, fallout, nuclear winter | ✅ | Strike always behind a confirmation dialog |
| Launch on warning, retaliation, deterrence in AI war decisions | ✅ | |
| Arms control treaty | ✅ | Cap 1,550 warheads, dismantling, AI proposals |
| Cyber operations | ✅ | Espionage, sabotage, disruption, disinformation with visible odds |
| Satellites, anti-satellite weapons, debris | ✅ | Four kinds with effects; debris threatens everyone |
| Space projects: stations and settlements | ✅ | Fictional technologies, labelled as such |
| Strategic and future-scenario events | ✅ | 19 strategic, 35 (2035) and 29 (2085) events |
| Starting forces for every scenario | ✅ | `tools/forces/*.csv` → fleets, wings, warheads, satellites |
| Future scenarios Flashpoint 2035 and Orbital Age 2085 | ✅ | Speculative fiction, labelled; built on the Modern World with the builder's base mode |
| Interface: Army/Navy/Air recruitment, fleet and wing cards, map orders, Strategic tab, depots, Naval and Supply map modes | ✅ | Browser check `tests/browser/m6.mjs` |
| Save v6 with migration | ✅ | Supply maps saved for deterministic reloads |
| Tests | ✅ | 39 new tests (118 in all) |
| Transport ships and capacity, naval mines, port sizes | ⬜ | Any army can embark in a friendly port |
| Aircraft attacking fleets, air control over sea zones | ⬜ | Air acts over land battles and bombing targets only |
| AI-planned amphibious invasions | ⬜ | The AI goes by sea only when its normal orders find it faster |
| Supply that consumes goods; fleet and air supply | ⬜ | Supply levels have no goods cost |
| Wing experience, warheads assigned to launchers | ⬜ | Fields exist but are not used |

## Later milestones

| Area | Status |
| --- | --- |
| Scenario editor UI | ⬜ |
| Navies, air forces, nuclear, cyber, space (M6) | ✅ See the Milestone 6 table |
| Rivers, real terrain/elevation data | ⬜ Terrain is estimated from coarse regions |
| Map projections other than Miller | ⬜ |
| Multiplayer | ⬜ Deterministic core is the foundation |
| Desktop app and installer | ✅ Native window (WebView2 on Windows, WebKitGTK on Linux) with on-disk saves; Windows installer and portable zip, Linux and macOS packages (launcher/README.md). Not code-signed; the WebView2 window is not yet tried on a real Windows PC; macOS opens a browser window |
| Android app | 🟨 APK with touch controls (pan, pinch, tap, long-press orders) and saves on the phone (android/README.md). Tested in an emulated touch screen only, not on a phone; the interface is the desktop one made denser |
| iOS app | ⬜ Postponed; needs a Mac to build |
| Audio, onboarding tutorial, accessibility pass | ⬜ |

## Known limitations

- Economy: electricity from gas, hydro and renewables is folded into thermal plants; goods are
  national pools with no internal transport; trade flows are automatic (agreements only remove
  tariffs).
- Diplomacy: starting treaties are a short hand-picked list (`tools/build_diplomacy.mjs`), not a
  full catalogue of real agreements. Starting governments use 8 broad types.
- Deposits and starting industry are generated from rounded national figures, not mapped
  from real mine locations.

- Terrain is estimated from latitude/longitude boxes; there are no rivers.
- Province population/GDP within a country are spread by a model, not census data.
- Islands are still linked by "sea lanes" that land armies cross without ships (when enemy
  fleets do not hold them); longer voyages go through sea zones. There are no transport ships.
- Flags are simplified patterns.
- Low-end measurements come from a cloud container (software rendering, emulated CPU throttling),
  not from real minimum-spec hardware.
- Historical borders are approximated with modern admin-1 provinces (one owner per province);
  figures are rounded estimates; armies are capped by an upkeep rule rather than taken at full
  historical size; ancient flags are invented.
- The war AI makes peace sooner than history did (the 1914 test run ended the Great War in
  1916), and wars outside scripted events are rarer than in history.

## Continuation plan

1. **Milestone 6 follow-ups**: transport capacity, aircraft against fleets, AI amphibious
   planning, supply with goods cost, winning back the simulation speed lost in M6.
2. **Milestone 5 follow-ups**: a scenario editor UI, more start dates (1444, 1815, 1861),
   colonisation of unowned land, a war AI that sustains long wars, technology trading.
3. **Milestone 4 follow-ups**: civil wars, the player's own bloc votes, UN-style votes and
   partial sanctions, AI government reform.
4. Economy follow-ups: a gas and renewable energy split, transport costs.
