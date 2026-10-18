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
| Movement between connected provinces | ✅ | Land, straits, sea lanes (sea lanes are a stand-in for naval transport) |
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
| Technology tree with prerequisites (data file) | ✅ | 119 technologies, 13 eras from Ancient to Future, 13 fields; 13 speculative technologies |
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
| Navy, air and space technologies with their own systems | 🟡 | In the tree with general effects; the systems arrive in Milestone 6 |
| More scenarios (e.g. 1444, 1815, 1861) | ⬜ | The format supports any date; each needs a definition file and events |

## Later milestones

| Area | Status |
| --- | --- |
| Scenario editor UI | ⬜ |
| Navies, air forces, nuclear, cyber, space (M6) | ⬜ |
| Rivers, real terrain/elevation data | ⬜ Terrain is estimated from coarse regions |
| Map projections other than Miller | ⬜ |
| Multiplayer | ⬜ Deterministic core is the foundation |
| Native desktop packaging (Tauri/Neutralinojs) | ⬜ |
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
- Islands are linked by "sea lanes" that land armies cross slowly; there are no fleets yet.
- Flags are simplified patterns.
- Low-end measurements come from a cloud container (software rendering, emulated CPU throttling),
  not from real minimum-spec hardware.
- Historical borders are approximated with modern admin-1 provinces (one owner per province);
  figures are rounded estimates; armies are capped by an upkeep rule rather than taken at full
  historical size; ancient flags are invented.
- The war AI makes peace sooner than history did (the 1914 test run ended the Great War in
  1916), and wars outside scripted events are rarer than in history.

## Continuation plan

1. **Milestone 6**: navies (sea zones derived from the coastline), then air forces, nuclear
   weapons, cyber and space, using the navy, air and space technologies already in the tree.
2. **Milestone 5 follow-ups**: a scenario editor UI, more start dates (1444, 1815, 1861),
   colonisation of unowned land, a war AI that sustains long wars, technology trading.
3. **Milestone 4 follow-ups**: civil wars, the player's own bloc votes, UN-style votes and
   partial sanctions, AI government reform.
4. Economy follow-ups: a gas and renewable energy split, transport costs.
