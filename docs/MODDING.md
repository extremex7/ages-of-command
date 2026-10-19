# Modding and data formats

All gameplay data lives in JSON files under `data/`. Files are validated on load; errors name the
file section and field.

## Units — `data/rules/units.json`

Each key is a unit type id. Fields (all required): `name`, `short`, `men`, `cost` and `upkeep`
(billions at price level 1.0; scaled per country by its price level), `days` (training time),
`attack`, `defense`, `speed` (km/day), `width`, `toughness` (absorbs damage), and `terrain` — an
attack multiplier for each of `plains, hills, mountains, forest, desert, tundra`.
Adding a new key adds a recruitable unit everywhere in the UI.

**Domains (Milestone 6).** `domain` is `land` (the default), `sea` or `air`. Sea units form
fleets and air units form air wings ([NAVY_AIR.md](NAVY_AIR.md)); they need a `role`, and land
units' `terrain` and `width` are not used for them. Validation (`src/core/rules.js`):

| Domain | Roles | Extra numeric fields (non-negative) |
| --- | --- | --- |
| `land` | `line`, `support`, `mobile` | `munitions`, `fuel`, `siege` |
| `sea` | `capital`, `screen`, `sub`, `nsub`, `ssbn`, `carrier` | `asw`, `aa`, `stealth`, `raid`, `shore`, `air`, `warheads` |
| `air` | `fighter`, `bomber`, `attack`, `drone` | `air`, `bomb`, `range` (required, km from base) |

Every domain may also set `group` (real ships or aircraft one unit stands for; used by
`tools/build_forces.mjs`), `munitions` and `fuel`. Unit types of a domain are only accepted in
that domain's formation when a save is loaded. `fictional: true` and `crewless: true` are
recorded but have no rule of their own (a unit is gated by its `tech`). The AI and the forces
builder field the newest unit of each role, so a new role needs code; a new unit in an existing
role is picked up automatically.

## Balance — `data/rules/balance.json`

Sections `economy`, `population`, `combat`, `siege`, `war`, `ai`, `industry`, `government`,
`diplomacy`, `research`, and since Milestone 6 `naval`, `air`, `supply` and `strategic` (every
key is explained in [NAVY_AIR.md](NAVY_AIR.md), [LOGISTICS.md](LOGISTICS.md) and
[STRATEGIC.md](STRATEGIC.md); a missing section is rejected on load). Notable values:
`economy.devBase/devGrowth` (productivity curve), `combat.width` per terrain,
`combat.defenderTerrain`, `siege.baseDays/fortDays/devDays`, `war.truceDays`,
`ai.baseWarChance`, `ai.powerRatioForWar`, and in `industry` the workforce shares, price
elasticity and limits, shortage penalties, army consumption, infrastructure and construction-slot
rules (all explained in [ECONOMY.md](ECONOMY.md)). `government` and `diplomacy` hold every number
in [GOVERNMENT.md](GOVERNMENT.md) and [DIPLOMACY.md](DIPLOMACY.md) (approval curve, coup and
revolution thresholds, policy costs, treaty opinions, breaking penalties, peace-term costs, AI
cadence). The optional sections `civilWar`, `commanders` and `espionage` hold the civil-war rules
([GOVERNMENT.md](GOVERNMENT.md)), the generals, their traits and battle plans
([MILITARY.md](MILITARY.md)) and spy networks ([ESPIONAGE.md](ESPIONAGE.md)); without them
those features are off. A trait is
`{ name, text, attack?, defense?, speed?, orgRecovery?, orgLoss?, siege?, supply?, terrain?, role? }`.

## Goods — `data/rules/goods.json`

Each key is a good id: `name`, `tier` (display only), `price` (B per unit, > 0), `demand` (units per
million people per month at development 80), `incomeExp` (how demand scales with income), and
`stockMonths` (stockpile target). A new good is traded and shown automatically; give it a building
that produces it and, if people should consume it, a `demand` above 0.

## Buildings — `data/rules/buildings.json`

Each key is a building id, run in file order every month: `name`, `out` and `in` (good → units per
level per month), `workers` per level, `cost` (B at price level 1), `goods` consumed when
construction starts, `days`, `maxLevel` (≤ 255), optional `deposit` (resource name; levels cannot
exceed the province's deposit), `fertility: true` (scales with farmland), `site: "solar"` or `"wind"` (scales with the province's sunshine or wind), `minDev`. Saves store the ids of goods, buildings and resources, so adding or reordering them keeps old saves loadable (new resources take their deposits from the scenario).
Put producers before their consumers so this month's output is available downstream.

## Governments — `data/rules/governments.json`

- `families`: id → `{ name, opinion: { otherFamily: value } }` (diplomacy opinion between families).
- `types`: id → `{ name, family, electionYears (0 = none), stability, legitimacy, taxEff, manpower,
  warPropensity, liberty, coupRisk, support: { faction: share }, policies: { group: option },
  reformsTo: [typeIds], ruling (autocracies) }`.
- `drivers`: descriptions of the approval drivers (`tax, services, defence, prosperity, peace,
  glory, liberty, order, faith, planning`); the formulas are in code.
- `factions`: id → `{ name, color, electable, prefers (government type after a revolution),
  weights: { driver: weight } }`.
- `policies`: group → `{ name, options: { id: { name, effects } } }`.

Effects (policies, event modifiers) may use: `stability`, `legitimacy`, `taxEff` (added),
`manpower`, `construction`, `coupRisk` (multipliers), `liberty`, and `faction: { id: approval }`.
Unknown keys are rejected on load with the file and field named.

## Events — `data/events/*.json` + `index.json`

`index.json` lists the files, in order: `{ "files": ["domestic.json", "world.json", "history_1914.json", …] }`. Each file is `{ "events": [ … ] }`:

```json
{ "id": "general_strike", "title": "General strike",
  "text": "Unions in {country} have called a general strike…",
  "mtth": 18, "cooldownYears": 4,
  "conditions": { "support.socialists": [">", 0.08],
                  "any": [{ "unemployment": [">", 0.09] }, { "approvalOf.socialists": ["<", 35] }] },
  "options": [{ "text": "Meet the unions' demands", "ai": 2,
                "effects": { "treasuryMonths": -0.5, "civilShare": 0.02,
                             "modifier": { "name": "Union settlement", "months": 24,
                                           "effects": { "faction": { "socialists": 15 } } } } }] }
```

- `mtth`: mean time to happen in months while the conditions hold; `ai`: relative weight of an
  option for AI countries (and for the player's advisers after 30 days).
- Text placeholders: `{country}`, `{rival}`, `{neighbour}`.
- Condition keys compare `[op, value]` with `op` one of `< <= > >= =`: `stability, legitimacy,
  approval, unemployment, inflation, foodSat, living, tax, civilShare, warMonths, warScore,
  provinces, avgDev, monthsToElection, treasuryMonths`, `support.<faction>`,
  `approvalOf.<faction>`. Booleans: `atWar, hasRival, rivalNeighbour, neighbourAtWar`. Also
  `policy.<group>: "option"`, `family: [ids]`, `gov: [ids]`, and nesting with `any: [ … ]` and
  `not: { … }`.
- Effect keys: `stability, legitimacy, treasuryMonths, tax, civilShare, manpower, support
  { faction: delta }, opinion `{ target: "rival" | "neighbour" | TAG, value }`, popShare, dev, modifier
  { name, months, effects }`.
- Historical events (Milestone 5) add `scenario`, `tags`, `date`, `once`, `news`, an option flag
  `historical`, conditions such as `exists`, `atWarWith`, `warBetween`, `hasTech`, `ownsAny`,
  `fired`, `year`, and effects such as `war`, `annex`, `transfer`, `release`, `government`,
  `treaty`, `techs` and `trigger`. The full list and how they fire: [SCENARIOS.md](SCENARIOS.md).
- Milestone 6 conditions: `warheads`, `satellites`, `worldNukes` (numbers) and `hasNukes`
  (boolean); effects: `warheads`, `satellites`, `cyber`, `stations`, `colonies` (deltas; see
  [STRATEGIC.md](STRATEGIC.md)). `treaty` accepts `arms_control`.

## Technologies — `data/rules/technologies.json`

`eras` (id, name, start year, `manpowerShare`), `fields` (id → name) and `techs`:

```json
"rifled_firearms": { "name": "Rifled Firearms", "era": "industrial", "field": "army", "year": 1850, "cost": 1.2,
  "req": ["machine_tools", "firearms"], "effects": { "combat": 0.12 },
  "unlocks": { "units": ["rifles"] }, "desc": "…" }
```

- `effects` keys: `farm mine industry research popGrowth combat movement siege devGrowth tax
  construction` (fractions; normalised against all real technologies up to 2020).
- `unlocks`: `goods`, `buildings`, `units`, `govTypes`. A unit can also name its technology with
  `"tech"` in units.json, which must agree. Units have a `role` (`line`, `support`, `mobile`),
  and optional `munitions` (default 1), `fuel` (default 0) and `siege` (default 1) factors.
- `fictional: true` marks speculative technologies (never given at a scenario start).
- Icons: the technology tree shows the icon named for the technology in `TECH_ICONS` of
  `tools/build_icons.mjs` (Lucide names; rerun the tool), otherwise its field's icon.
- Prerequisite cycles, unknown ids and unknown effect keys are rejected when the rules load.
  Formulas: [TECHNOLOGY.md](TECHNOLOGY.md).

## Historical scenario definitions — `tools/history/*.json`

Historical scenarios are written as country lists with region rules (ISO codes, boxes, polygons,
province names) and built into scenario files with `node tools/build_history.mjs --economy`.
A definition with `base` starts from an existing scenario instead and lists only what changes
(new and merged countries, `remove`, `growth` multipliers, `keepDiplomacy`), which is how the
future scenarios are made. Format: [tools/history/README.md](../tools/history/README.md);
overview: [SCENARIOS.md](SCENARIOS.md).

## Starting forces — `tools/forces/*.csv`

One row per country with real counts of ships, aircraft, warheads, missiles and satellites:
`tag,carriers,capital,screens,subs,nsubs,ssbns,fighters,bombers,attack,drones,warheads,icbms,satellites,note`
(optional `stations`, `colonies`). `node tools/build_forces.mjs <scenario>` (or
`npm run build:forces` for every table) writes the scenario's `fleets`, `wings` and per-country
strategic fields. Format and rules: [tools/forces/README.md](../tools/forces/README.md).

## Sea zones — `data/map/seas.json`

Generated by `tools/build_seas.py` (`npm run build:seas`) from Natural Earth land and
`data/map/world.json`; regenerate it after a map rebuild. Contents:

- `zones`: `{ id, name, lon, lat, x, y, cells }` (seed point, projected position, water cells).
- `links`: `{ a, b, km, name?, choke?: [province ids], opens?: year }`: zone adjacency, with
  chokepoints (closed to enemies of whoever controls a listed province) and canal opening years.
- `ports`: province id → up to 3 zone ids the province's coast opens onto.
- `lanes`: `[provinceA, provinceB, zone]` for every strait and sea lane of the province graph.
- `grid`: `{ res: 0.5, lon0, lat0, cols, rows, rle }`, zone id per 0.5° cell (−1 land),
  run-length encoded as `[value, count, …]`.

To add a strait or canal, add it to `LINKS` in `tools/build_seas.py` (zone names, commanding
province ids, optional `opens`) and rebuild; zones are added as seeds in `SEEDS`. Zone ids are
assigned in seed order, so inserting a seed renumbers later zones and invalidates saved fleets in
them (saves drop fleets in zones that no longer exist).

## Scenarios — `data/scenarios/*.json` + `index.json`

```json
{
  "id": "my_scenario", "name": "My Scenario", "era": "modern", "startDate": "2026-01-01",
  "description": "…", "approximations": "what is estimated",
  "autoBudget": true,
  "countries": [{ "tag": "FRA", "name": "France", "color": "#4a68c4", "gov": "republic",
                  "capital": 798, "aggression": 0.25, "stability": 55,
                  "flag": { "pattern": "v", "colors": ["#0055a4", "#ffffff", "#ef4135"] } }],
  "provinces": { "798": ["FRA", 9200000, 85.3, 3] },
  "alliances": [{ "name": "NATO", "members": ["USA", "FRA"] }],
  "diplomacy": { "blocs": [{ "name": "European Union", "kind": "economic", "members": ["FRA", "DEU"] }],
                 "treaties": [{ "type": "alliance", "a": "USA", "b": "JPN" }],
                 "rivals": [["IND", "PAK"]] },
  "armies": [{ "owner": "FRA", "province": 798, "units": { "infantry": 3, "artillery": 1 } }]
}
```

- `provinces` maps a stable province id to `[ownerTag, population, development 0–100, fort 0–5,
  infrastructure 0–10]` (infrastructure is optional; default development / 11).
- `economy` (optional): `{ "deposits": { "798": { "timber": 2 } }, "buildings": { "798": { "farm": 4,
  "factory": 3 } } }`. Unknown building or resource names are ignored. Without it the scenario
  starts with no industry. `node tools/build_economy.mjs <scenario>` generates it from
  `tools/resource_table.csv`.
  Province ids are listed in `data/map/world.json` (`provinces[].id`, `name`, `iso`) and never change.
- `gov` is one of `republic, federal_republic, parliamentary, const_monarchy, abs_monarchy,
  one_party, military, theocracy`.
- `diplomacy` (optional): `blocs` (`kind` is `defense` or `economic`), `treaties` (`type` one of
  `alliance, defensive, nap, access, guarantee, trade, subject`; for directed types `a` is the
  grantor, guarantor or overlord) and `rivals` (`[tag, rivalTag]`). Invalid treaties are skipped.
  `node tools/build_diplomacy.mjs` writes the Modern World's.
- Flag `pattern`: `h` (horizontal bands), `v` (vertical), `disc`, `cross`. This stylised flag is
  shown when the country has no flag file.
- Flag files: `data/flags/index.json` maps each tag to an SVG under `data/flags/` (without
  `.svg`). `default` applies in every scenario; `scenarios.<id>` overrides it per scenario, and
  `null` keeps the pattern flag. Flags are drawn at 4:3. To give a new country a real flag, add
  an SVG (viewBox 640×480 works best) and its tag to the scenario's entry.
- `autoBudget` sets each country's civil spending so its starting army is affordable.
- Register the file in `data/scenarios/index.json` to show it in the New Game screen.
- Dates use astronomical years (`-0499-01-01` = 500 BCE).
- Milestone 5 fields: top-level `techYear` (countries know technologies up to this year),
  `wars` (`[{ attackers: [tags], defenders: [tags], name? }]`, running at the start) and
  `releases` (`{ TAG: [province ids] }` for dormant countries). Per country: `techLag`,
  `techYear`, `techs` (extra ids), `researchShare`, `policies` (`{ group: option }`) and `dormant`
  (owns nothing until an event releases it).
- Unit types in `armies` must exist in units.json; a scenario should only give units its
  countries know.
- Milestone 6 fields: top-level `fictional` (countries may start with fictional technologies),
  `fleets` (`[{ owner, port?: province id, zone?: zone id, units: { type: n }, name? }]`; a fleet
  with a `port` is docked there, otherwise it is at sea in `zone`) and `wings`
  (`[{ owner, base: province id, units, mission?, name? }]`, mission `superiority`, `support`,
  `bombing` or `idle`). Per country: `warheads`, `icbm`, `sats` (`{ recon, comms, nav, warning }`),
  `stations`, `colonies`, each installed only if the country knows the matching technology.
  Treaties may include `arms_control` (both countries need warheads).

Planned: a scenario editor UI.
