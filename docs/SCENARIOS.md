# Scenarios and historical events (Milestone 5)

## Playable scenarios

| Scenario | Start | Countries at start (+ dormant) | Notes |
| --- | --- | --- | --- |
| Modern World | 1 Jan 2026 | 196 | Present-day borders, built from Natural Earth (Milestones 1–4) |
| Height of Rome | 11 Aug 117 | 29 (+3) | Rome, Parthia, Kushan, Han and 25 smaller polities. 1,686 provinces are unowned: lands without states of the period |
| The Great War | 1 Jun 1914 | 67 (+10) | Alliance blocs, colonial empires. Dormant: Poland, Finland, the Baltic states, Czechoslovakia, Hungary, Austria, Yugoslavia, Ukraine |
| The Gathering Storm | 1 Jan 1936 | 78 (+1) | Italy at war with Ethiopia. Dormant: the Chinese communists |
| The Cold War | 1 Jan 1962 | 123 (+20) | NATO, Warsaw Pact, EEC, Comecon. Dormant: the Soviet republics and colonies still to become independent |

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
- Navies, air forces and nuclear weapons arrive in Milestone 6. Until then, events about them use
  technologies, treaties and wars.
