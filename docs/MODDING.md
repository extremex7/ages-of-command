# Modding and data formats

All gameplay data lives in JSON files under `data/`. Files are validated on load; errors name the
file section and field.

## Units — `data/rules/units.json`

Each key is a unit type id. Fields (all required): `name`, `short`, `men`, `cost` and `upkeep`
(billions at price level 1.0; scaled per country by its price level), `days` (training time),
`attack`, `defense`, `speed` (km/day), `width`, `toughness` (absorbs damage), and `terrain` — an
attack multiplier for each of `plains, hills, mountains, forest, desert, tundra`.
Adding a new key adds a recruitable unit everywhere in the UI.

## Balance — `data/rules/balance.json`

Sections `economy`, `population`, `combat`, `siege`, `war`, `ai`, `industry`. Notable values:
`economy.devBase/devGrowth` (productivity curve), `combat.width` per terrain,
`combat.defenderTerrain`, `siege.baseDays/fortDays/devDays`, `war.truceDays`,
`ai.baseWarChance`, `ai.powerRatioForWar`, and in `industry` the workforce shares, price
elasticity and limits, shortage penalties, army consumption, infrastructure and construction-slot
rules (all explained in [ECONOMY.md](ECONOMY.md)).

## Goods — `data/rules/goods.json`

Each key is a good id: `name`, `tier` (display only), `price` (B per unit, > 0), `demand` (units per
million people per month at development 80), `incomeExp` (how demand scales with income), and
`stockMonths` (stockpile target). A new good is traded and shown automatically; give it a building
that produces it and, if people should consume it, a `demand` above 0.

## Buildings — `data/rules/buildings.json`

Each key is a building id, run in file order every month: `name`, `out` and `in` (good → units per
level per month), `workers` per level, `cost` (B at price level 1), `goods` consumed when
construction starts, `days`, `maxLevel` (≤ 255), optional `deposit` (resource name; levels cannot
exceed the province's deposit), `fertility: true` (scales with farmland), `minDev`.
Put producers before their consumers so this month's output is available downstream.
Changing the number of buildings or resources makes older saves of that mod refuse to load with a
message (their arrays no longer match).

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
- Flag `pattern`: `h` (horizontal bands), `v` (vertical), `disc`, `cross`.
- `autoBudget` sets each country's civil spending so its starting army is affordable.
- Register the file in `data/scenarios/index.json` to show it in the New Game screen.
- Dates use astronomical years (`-0499-01-01` = 500 BCE).

Planned: event scripts, technologies and a scenario editor UI (Milestone 5).
