# Scenarios and historical events (Milestones 5 and 6)

## Playable scenarios

| Scenario | Start | Countries at start (+ dormant) | Notes |
| --- | --- | --- | --- |
| Modern World | 1 Jan 2026 | 196 | Present-day borders, built from Natural Earth (Milestones 1–4) |
| Height of Rome | 11 Aug 117 | 29 (+3) | Rome, Parthia, Kushan, Han and 25 smaller polities. 1,686 provinces are unowned: lands without states of the period |
| Rise of Empires | 11 Nov 1444 | 133 (+1) | The day after Varna: the Ottoman–Hungarian war is running, Byzantium holds Constantinople and the Morea, England holds Normandy and Gascony under the Truce of Tours. Dormant: Sweden. 1,318 provinces are unowned |
| Concert of Europe | 20 Nov 1815 | 91 (+9) | Quadruple Alliance and German Confederation; Spain at war with New Granada and the Río de la Plata; the East India Company at war with Nepal. Dormant: Greece, Belgium and seven Latin American states. 787 provinces are unowned |
| A House Divided | 12 Apr 1861 | 107 (+2) | The American Civil War, the Taiping Rebellion and the Cochinchina campaign are running; German Confederation. Dormant: the Mexican Empire and Poland. 432 provinces are unowned |
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

### 1444, 1815 and 1861

**Rise of Empires** (`tools/history/rise_of_empires_1444.json`, events `history_1444.json`)
starts the day after Varna. The Ottomans face a reduced Byzantium and a Hungary still at war with
them (Wallachia is Hungary's subject); Poland, with Masovia and Moldavia as subjects, is allied to
a separately ruled Lithuania; Muscovy shares Russia with Novgorod, Pskov, Tver and Ryazan; the
Kalmar Union, the Teutonic and Livonian Orders, England with Normandy and Gascony, France,
Burgundy, the Italian states, Castile, Aragon, Portugal and Granada fill Europe, with ten Holy
Roman Empire states, one per German province. Beyond Europe: the Mamluks, Timurids and Turkmen
confederations, the Golden Horde's successors, Ming, Joseon and the Ashikaga, South-East Asia, the
Indian sultanates and Vijayanagara, West and East African kingdoms, the Aztecs and the Inca. 25
events follow the period: the Kalmar break-up, Tumu, the end of the Hundred Years' War, the Wars
of the Roses, Gutenberg, the fall of Constantinople, the Thirteen Years' War, the Ōnin War, the
Catholic Monarchs and Granada, Columbus, da Gama, Novgorod and the Ugra, and the Burgundian
inheritance. Simplifications: minor states (Siena, Ferrara, Navarre, Ragusa, the Hanseatic towns,
most Imperial lordships) are merged into neighbours; Byzantium and Granada look larger than they
were because their provinces include more land; Genoa is drawn without its home coast; Serbia's
and Byzantium's tribute to the Ottomans is not modelled; American societies lag thousands of years
on the Eurasian technology tree.

**Concert of Europe** (`concert_1815.json`, events `history_1815.json`) starts on the day of the
Second Treaty of Paris. Prussia has the Rhineland, Austria Lombardy–Venetia; the United Kingdom of
the Netherlands, Sweden with Norway, and Congress Poland and Finland as Russian subjects are in
place, and the German states are merged where the map is too coarse (Hanover is Britain's
subject). The East India Company is its own country allied to Britain, with Hyderabad, Mysore,
Travancore and Baroda as subjects, beside the Marathas, the Sikhs, Nepal and others. Spain holds
royalist America and fights New Granada and the Río de la Plata; nine later states (Greece,
Belgium, Mexico, Central America, Colombia, Chile, Peru, Bolivia, Brazil) are released by events
such as Chacabuco, Iguala, Ayacucho, Ipiranga and the Greek and Belgian revolutions. 25 events in
all, to 1848. Simplifications: small states are folded into neighbours, lands without modelled
states are unowned, the Company has an absolute-monarchy government, and a released American
state gets a truce with Spain, so its war of independence ends when the event fires.

**A House Divided** (`house_divided_1861.json`, events `history_1861.json`) opens at Fort Sumter
with three wars running: the Union against the seven-state Confederacy and the Qing against the
Taiping, both as civil wars (`"kind": "civil"`: no early AI peace, reunion when the government
holds every rebel province, independence after a long stalemate), and France and Spain against
Vietnam. Virginia, North Carolina, Tennessee and Arkansas start in the Union and secede by the
opening event chain. Italy has just been proclaimed, with Venetia Austrian and Rome papal; the
German Confederation is a defence bloc. 43 events (about 30 episodes, the rest chained steps)
cover the Civil War to Appomattox, Maximilian's Mexico, the wars that made the German Empire, the
Austro-Hungarian Compromise, the Meiji Restoration, the capture of Rome, Canadian Confederation,
the Alaska Purchase, the Suez Canal and the Paraguayan War. Simplifications: German minor states
are merged, Natal is part of the Zulu Kingdom, Native-held lands belong to the claimant states,
and the German Empire is made by annexation and renaming. In test runs the Union usually wins by
1863 and the Taiping fall within a year, faster than history.

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
| Rise of Empires 1444 | 22 | 29 (17) | 630 | 0 | 0 | 0 | 0 |
| Concert of Europe 1815 | 23 | 34 (19) | 484 | 0 | 0 | 0 | 0 |
| A House Divided 1861 | 23 | 46 (22) | 599 | 0 | 0 | 0 | 0 |
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

## Scenario editor

Main menu → **Scenario Editor**. Pick any scenario (built in or custom) and press **New scenario
from this** to edit a copy, or **Edit** a custom one. The map works as in the game; the side
panel has the tools:

- **Select** shows the clicked province and its owner. **Paint** gives each clicked province to
  the brush country (or leaves it unclaimed); **Fill** gives it every land-connected province of
  the clicked province's owner, for example a whole country at once.
- **Add country** creates a new country with a three-letter tag from its name, then paints with
  it. A selected country's name, colour, government, stability, treasury, AI aggression and
  technology lag can be changed; treaties (alliance, defensive pact, non-aggression, military
  access, guarantee, trade, arms control, subject) and wars at the start are added or removed in
  the same place. **Delete country** leaves its land unclaimed and removes its forces, treaties
  and wars.
- A selected province's population, development and fort level can be changed, it can be made
  its owner's capital, and armies there can be added (any land unit, by count) or removed.
- **Scenario** holds the name, the start date, the technology year and the description.

**Save scenario** first tidies the scenario (`tidyScenario` in `src/core/scenario_edit.js`):
capitals move into their country, armies abroad go home unless their country is at war with the
owner, fleets move to one of their own ports, air wings to the capital, and forces of countries
with no land are removed; it lists what it changed. The scenario is then checked like a built-in
one and must start. Saved scenarios are kept with the saves (browser storage, or the apps' data
folder) and appear in the New Game list; saves made in them need the scenario to load.
**Export file** downloads the JSON (see MODDING.md), and the editor's first screen imports such
a file.

Limits: deposits and starting buildings stay with their provinces (painting a province keeps
them), blocs and rivalries are kept but not edited, fleets and air wings cannot be added, and
new countries get a simple pattern flag.

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
