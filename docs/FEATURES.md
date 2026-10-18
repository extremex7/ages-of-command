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
| Embargoes; war closes trade | ✅ | Player embargo button; AI does not embargo yet |
| Inflation / CPI and price level | ✅ | CPI raises unit, upkeep and construction costs |
| Army supply (munitions, fuel) | ✅ | Shortages weaken combat and slow armour; shown in battle reports |
| AI investment | ✅ | Builds against its largest shortfalls; logs reasons |
| Economic reports and calculation tooltips | ✅ | Indicators, budget, stability drivers, 24-month charts, per-good breakdown |
| Trade agreements, tariffs per partner, AI sanctions | ⬜ | |
| Gas/hydro/renewable power, transport costs, regional markets | ⬜ | Folded into simpler rules (see ECONOMY.md) |

## Later milestones

| Area | Status |
| --- | --- |
| Diplomacy: treaties, relations values, alliance diplomacy, AI negotiation (M4) | 🟡 Pre-set alliances, war/peace only |
| Government, ideology, factions, elections, revolutions (M4) | 🟡 Government type affects AI aggression only |
| Technology tree and era progression (M5) | ⬜ |
| Historical scenarios, event engine, scenario editor (M5) | ⬜ Scenario format + loader + validation exist |
| Navies, air forces, nuclear, cyber, space (M6) | ⬜ |
| Rivers, real terrain/elevation data | ⬜ Terrain is estimated from coarse regions |
| Map projections other than Miller | ⬜ |
| Multiplayer | ⬜ Deterministic core is the foundation |
| Native desktop packaging (Tauri/Neutralinojs) | ⬜ |
| Audio, onboarding tutorial, accessibility pass | ⬜ |

## Known limitations

- Economy: electricity from gas, hydro and renewables is folded into thermal plants; goods are
  national pools with no internal transport; trade is automatic, with no agreements.
- Deposits and starting industry are generated from rounded national figures, not mapped
  from real mine locations.

- Terrain is estimated from latitude/longitude boxes; there are no rivers.
- Province population/GDP within a country are spread by a model, not census data.
- Islands are linked by "sea lanes" that land armies cross slowly; there are no fleets yet.
- Peace ends the whole war; co-belligerents can't sign separately.
- Flags are simplified patterns.
- Low-end measurements come from a cloud container (software rendering, emulated CPU throttling),
  not from real minimum-spec hardware.

## Continuation plan

1. **Milestone 3 follow-ups**: trade agreements and per-partner tariffs, AI sanctions, a gas and
   renewable energy split.
2. **Milestone 4**: relations values and trust, alliance/NAP/military-access diplomacy with AI
   evaluation, separate peace, stability-driven unrest and government changes, events (data-driven).
3. **Milestone 5**: technology tree in data files, era progression, a 1914 and a 1936 scenario
   built by remapping province ownership, an event engine with conditions/choices.
4. Navies (sea zones derived from the coastline), then air, then modern/futuristic systems.
