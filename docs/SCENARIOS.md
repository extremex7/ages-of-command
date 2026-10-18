# Scenarios and historical events (Milestones 5 and 6)

## Playable scenarios

| Scenario | Start | Countries at start (+ dormant) | Notes |
| --- | --- | --- | --- |
| Modern World | 1 Jan 2026 | 196 | Present-day borders, built from Natural Earth (Milestones 1–4) |
| Height of Rome | 11 Aug 117 | 29 (+3) | Rome, Parthia, Kushan, Han and 25 smaller polities. 1,686 provinces are unowned: lands without states of the period |
| The Great War | 1 Jun 1914 | 67 (+10) | Alliance blocs, colonial empires. Dormant: Poland, Finland, the Baltic states, Czechoslovakia, Hungary, Austria, Yugoslavia, Ukraine |
| The Gathering Storm | 1 Jan 1936 | 78 (+1) | Italy at war with Ethiopia. Dormant: the Chinese communists |
| The Cold War | 1 Jan 1962 | 123 (+20) | NATO, Warsaw Pact, EEC, Comecon. Dormant: the Soviet republics and colonies still to become independent |
| Flashpoint 2035 (**fiction**) | 1 Jan 2035 | 197 | Milestone 6. The 2026 world nine years on, with invented crises; see "Future scenarios" below |
| Orbital Age 2085 (**fiction**) | 1 Jan 2085 | 131 | Milestone 6. An invented world of federations and space powers; see "Future scenarios" below |

Every scenario shows its approximations on the New Game screen. The main ones:

- Borders follow modern admin-1 provinces, and each province goes to whoever held most of it.
- Population and GDP are rounded Maddison-style estimates, and they include colonies.
- Within a country, population follows today's distribution, flattened.
- Armies are rounded peacetime strengths, capped so that upkeep is at most a third of a typical
  tax revenue. Without the cap, budgets would not balance under the game's upkeep model.
- Deposits come from the Modern World, because geology does not change. Starting industry is
  sized to each scenario's own demand and technology.
- Flags of ancient polities are invented standards.

Height of Rome has no historical wars at start. The 1914 file leaves Svalbard and Bouvet Island
unowned.

## Future scenarios (Milestone 6): speculative fiction

Flashpoint 2035 and Orbital Age 2085 are **speculative fiction, not forecasts**. Both are marked
`"fictional": true`, which is the only case in which countries start with technologies flagged
`fictional` (TECHNOLOGY.md). The New Game screen shows their premise and approximations like
any other scenario. Both are built in the builder's "base" mode on top of the Modern World
(tools/history/README.md): 2026 provinces, countries and armies, then the changes below.

**Flashpoint 2035** (`tools/history/flashpoint_2035.json`, events `data/events/future_2035.json`)

- Premise: a crowded multipolar world on edge: the Taiwan Strait, a newly independent Greenland
  and the Arctic, India and Pakistan over Kashmir and the Indus, Hormuz, the Nile and a war for
  the Red Sea coast.
- Borders are those of 2026 except Greenland, independent from Denmark (invented). Population and
  GDP are 2026 figures times per-country growth multipliers (`growth`; default ×1.07 population,
  ×1.3 GDP). Diplomacy is the Modern World's plus AUKUS and the Alliance of Sahel States as
  defence blocs, seven treaties and 23 rivalries. One war is running at start: Ethiopia against
  Eritrea (invented).
- Technology: 22 frontier countries (technology lag 0) start with the first fictional
  technologies of 2035: Quantum Computing, Directed-Energy Weapons and Precision and Vertical
  Farming. Everyone else is one year behind and has none.
- Events (35, all invented): the Taiwan Strait drills, quarantine and standoff chain; the chip
  fabs; a shoal collision; suitors for Greenland and the Northern Sea Route; Baltic cables and a
  Russian exercise; Kashmir strikes and the hotline; the Indus waters; Iran at the nuclear
  threshold; Hormuz tankers, escorts and mines; a Gulf heat dome; the Nile drought, ultimatum and
  war council; Red Sea talks; the Sahel transition; Essequibo; North Korean satellites; Geneva
  arms talks; Q-Day; a super-cyclone.

**Orbital Age 2085** (`tools/history/orbital_age_2085.json`, events `data/events/future_2085.json`)

- Premise: a warmer world of federations and blocs in which America, China and India hold each
  other in check with nuclear arsenals and orbital weapons, while stations, asteroid miners and
  the first settlements on the Moon and Mars make space the new frontier.
- **Entirely invented**: the European Federation (the 2026 EU, Ukraine, Moldova and the western
  Balkans), the East African and West African Federations, the South American Union, the Arabian
  Union, an independent Greenland and a reunified Korea; 71 countries of 2026 are merged away.
  Population and GDP are 2026 figures times rough multipliers standing for demographic change and
  climate damage. The Modern World's diplomacy is not kept; three defence blocs (Atlantic
  Concord, Eurasian Compact, Southern Concord), four economic blocs, 18 treaties (four of them
  arms-control treaties) and 12 rivalries are set instead. No war is running at start.
- Technology: the United States and China know every fictional technology up to 2085 (all but
  Artificial Superintelligence); other countries lag 5 to 40 years.
- Space: opening events give the United States and China 4 stations and 2 settlements and the
  next powers (European Federation, India, Japan, Russia) 2 and 1. 27 further invented events
  cover lunar ice, safety zones, a debris cascade, asteroid capture, space-based interceptors,
  Mars, a lunar shipyard strike, Belt secession, machine government and personhood, federal
  tensions, the end of oil, the Amazon, heat and migration.
- Because the shipped arms-control treaties cap arsenals at 1,550 warheads, the United States
  and China (2,500 each at start) dismantle 2% a month down to the cap (STRATEGIC.md).

## Starting navies, air forces and strategic forces (Milestone 6)

Every scenario has a forces table, `tools/forces/<id>.csv`, that `tools/build_forces.mjs` turns
into starting fleets, air wings, warheads, missiles and satellites (format and rules:
[tools/forces/README.md](../tools/forces/README.md)). Counts for the historical and modern
scenarios are rounded public figures (e.g. IISS and SIPRI for 2026, fleet lists for 1914 and
1936); the 2035 and 2085 counts are invented. Counts become game units of the newest type of each
role the country knows, and are cut when their upkeep would exceed 15% of a typical tax revenue,
so large historical navies and air forces start smaller than in the table.

| Scenario | Countries in table | Fleets (owners) | Ships | Air wings (units) | Warheads | Missiles | Satellites |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Modern World 2026 | 101 | 101 (53) | 1,308 | 201 (812) | 12,095 | 1,640 | 244 |
| Height of Rome 117 | 4 | 6 (3) | 410 | 0 | 0 | 0 | 0 |
| The Great War 1914 | 32 | 58 (26) | 1,191 | 7 (21) | 0 | 0 | 0 |
| The Gathering Storm 1936 | 47 | 58 (31) | 1,486 | 142 (872) | 0 | 0 | 0 |
| The Cold War 1962 | 63 | 87 (47) | 1,121 | 156 (781) | 28,504 | 795 | 7 |
| Flashpoint 2035 (fiction) | 73 | 113 (58) | 1,527 | 212 (983) | 11,310 | 1,680 | 375 |
| Orbital Age 2085 (fiction) | 40 | 80 (35) | 1,973 | 363 (7,756) | 10,020 | 1,960 | 1,283 |

"Ships" counts real ships after the upkeep cap (units × the ships each unit stands for).
Satellites are capped at 12 per kind (three times full coverage), so the large constellations in
the 2035 and 2085 tables start much smaller in the game.

## How a scenario is built

```
tools/history/<id>.json  --tools/build_history.mjs-->  data/scenarios/<id>.json
                         --tools/build_economy.mjs <id> --deposits-from=modern_2026-->  (adds economy)
npm run build:history    # both steps for every file in tools/history/
```

The definition format is in [tools/history/README.md](../tools/history/README.md). Countries are
lists of region rules: ISO codes, boxes, polygons, province names, ids and exclusions. Later
countries override earlier ones, and dormant countries record the provinces they would get when
released. The builder does the following:

- **Validation**: it checks tags, empty regions and unknown tags in diplomacy, then writes the
  scenario.
- **Population and development**: each country's population and GDP are spread over its
  provinces. Development is derived from GDP per head, using the same formula as the Modern World
  builder.
- **Armies**: it places armies of the newest units each country knows at its technology year,
  split 65% line, 20% support and 15% mobile.
- **Diplomacy**: subjects become `subject` treaties, followed by treaties, blocs and rivals. Wars
  are started when the game begins.
- **Rivalries**: scenario rivalries come with a "Historic enmity" opinion modifier (−50, fading
  over about ten years). This stops the AI from dropping them on day one.

Definitions with a `base` start from an existing scenario instead (the future scenarios); see
tools/history/README.md. After building, the builder runs `tools/build_forces.mjs` for every
scenario with a forces table.

Each country may also set `techLag` and `techYear` (see [TECHNOLOGY.md](TECHNOLOGY.md)), starting
`policies` (applied when governments are installed), `stability` and `aggression`.

To add a scenario:

1. Write `tools/history/<id>.json`. `node tools/list_provinces.mjs DEU POL` lists provinces.
2. Run `node tools/build_history.mjs --economy <id>`. The scenario is added to
   `data/scenarios/index.json`.
3. Optionally write `data/events/history_<id>.json` and add it to `data/events/index.json`.

## Historical events

Events use the Milestone 4 engine (`src/core/events.js`). Milestone 5 adds the fields and the
condition and effect keys below. All of them are validated when the rules load.

| Field | Meaning |
| --- | --- |
| `scenario: [ids]` | Only active in these scenarios |
| `tags: [TAGS]` | Only these countries can get it |
| `date: [from, to]` | Window, either end may be `null` |
| `once: true` | At most once per game, for anyone |
| `news: true` | Everyone sees it in the log |
| `mtth` | Mean time to happen in months while the conditions hold; `0` = the first time it is checked |
| option `historical: true` | What happened in history |

**Conditions** added: `year`, `independent`, `exists`, `notExists`, `atWarWith`, `notAtWarWith`,
`warBetween`, `allied`, `subjectOf`, `strongerThan`, `hasTech`, `notTech`, `ownsAll`, `ownsAny`
(modern ISO codes), `fired`, `notFired`.

**Effects** added: `war`, `joinWar`, `peace`, `annex`, `transfer`, `release`, `government`,
`rename`, `treaty`, `breakTreaties`, `rival`, `techs`, `research`, `trigger`, `claims`. Their
details:

- **`war`**: declares war, or joins the target's existing war on the opposite side. If that is
  impossible (an alliance, a truce), the reason is logged and nothing happens.
- **`breakTreaties`**: also leaves any defence bloc both countries are in. Put it before `war`.
- **`transfer`**: selects provinces of `from` by `border`, `iso`, `box` or `names`, and gives
  them to this country or to `to`.
- **`release`**: brings a dormant country to life with the provinces of `from` that its scenario
  regions name. It gets a treasury, manpower, an army and truces with the countries it left.
- **`trigger`**: queues an event for this country or another one. It is checked the next day,
  ignoring mtth but not conditions. That is how chains work: Sarajevo leads to the July
  Ultimatum, then the Austrian declaration and the German alliance decision.

**How they fire**: each country checks its events about once a month, on its own day.

- **Historical events**: each one rolls on its own (chance 1 − e^(−1/mtth)), and the first that
  succeeds with its conditions holding fires.
- **Random events**: domestic and world events share one roll per country.

**Alternate history**: nothing is forced, and every historical event has a premise in its
conditions. Kill Franz Ferdinand's empire first and Sarajevo never happens. Keep the Soviet Union
together and its republics stay dormant. AI countries choose between options by weight.

**New Game settings**:

- **Historical events**:
  - *Historical* (default): the historical option weighs 6× more.
  - *Plausible*: options are chosen on their own weights.
  - *Off*: no scenario or country-specific events.
- **Random events**: Rare, Normal or Frequent.

**Shipped events**:

| File | Events | Scope |
| --- | --- | --- |
| `domestic.json` | 17 | Any country, any scenario |
| `world.json` | 15 | Any scenario; some need technologies (oil, mass politics) and so cannot fire in 117 |
| `history_117.json` | 16 | Height of Rome |
| `history_1914.json` | 28 | The Great War |
| `history_1936.json` | 27 | The Gathering Storm |
| `history_1962.json` | 43 | The Cold War, including 14 per-republic events after a Soviet dissolution |
| `strategic.json` | 19 | Milestone 6: nuclear, cyber, satellite and space events for any scenario, gated by technology (STRATEGIC.md) |
| `future_2035.json` | 35 | Flashpoint 2035 (invented) |
| `future_2085.json` | 29 | Orbital Age 2085 (invented) |

In a test run of 1914 with seed `s1`, these fired:

- Sarajevo, the July Ultimatum and Austria's declaration (June 1914);
- Germany honouring its alliance and the Schlieffen Plan (August);
- Japan's and the Ottomans' entries;
- the Treaty of London, with Italy leaving the Triple Alliance;
- Bulgaria's entry and the Spanish flu.

The AI's war leadership then made peace in 1916, not 1918. That is the AI, not a script.

## Limits

- There is no scenario editor yet; scenarios are JSON files plus the builder.
- There are no colonisation mechanics: unowned land cannot be settled.
- `release` and `annex` act on one country each, so splits are written as one event per country.
- The historical event files predate Milestone 6, so their events about navies, air power and
  nuclear weapons still act through technologies, treaties and wars rather than the new systems.
- Starting forces are capped by upkeep, so they are smaller than historical navies and air
  forces; Height of Rome has galleys only and no aircraft.
- The future scenarios are fiction. Their populations, economies, forces and events are invented
  to be playable, not predicted.
