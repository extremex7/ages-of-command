# Historical scenario definition format (input to tools/build_history.mjs)

File: tools/history/<id>.json. The builder turns it into data/scenarios/<id>.json using the
shared world map (data/map/world.json, 2,358 admin-1 provinces with ISO-3 country code, name and
centroid lon/lat). List provinces with: `node tools/list_provinces.mjs POL DEU` (id, iso, name,
lon, lat, area, modern population); with no arguments it lists every ISO code and its province
count.

```jsonc
{
  "id": "great_war_1914",              // also the output file name
  "name": "The Great War",
  "era": "great_war",                  // one of: ancient classical medieval renaissance early_modern enlightenment industrial great_war world_war cold_war information near_future future
  "startDate": "1914-06-01",           // astronomical years for BCE ("-0499-01-01")
  "techYear": 1914,                    // countries know technologies first used up to this year, minus their techLag
  "description": "One or two sentences shown on the New Game screen.",
  "approximations": "Plain statement of what is estimated (borders follow modern admin-1 provinces, figures are rounded Maddison-style estimates, etc.).",
  "countries": [
    {
      "tag": "GER",                    // 2-8 capitals/digits, unique in the file
      "name": "German Empire",
      "color": "#6b6b6b",              // #rrggbb, restrained map colours; neighbours should differ clearly
      "gov": "const_monarchy",         // republic federal_republic parliamentary const_monarchy abs_monarchy one_party military theocracy
      "capital": [52.52, 13.40],       // [lat, lon]; the nearest owned province becomes the capital
      "pop": 67.0,                     // population in millions at the start date (rounded estimate)
      "gdp": 237,                      // GDP in billions of 1990 international dollars (Maddison-style, rounded)
      "techLag": 0,                    // years behind the scenario techYear (0 for leaders; 20-60 for laggards; up to ~300 for societies far from the frontier)
      "armyK": 800,                    // peacetime land forces at start in thousands of men (rounded)
      "aggression": 0.4,               // 0..1 AI aggression
      "stability": 60,                 // 0..100
      "policies": { "conscription": "mass" },   // optional; groups: conscription (volunteer|limited|mass), press (free|regulated|censored), economy (market|mixed|planned), administration (centralised|balanced|decentralised), religion (secular|tolerant|state)
      "flag": { "pattern": "h", "colors": ["#000000", "#ffffff", "#dd0000"] },  // h | v | disc | cross, 2-5 colours
      "dormant": false,                // true: exists but owns nothing at start; can be released by an event (its regions say what it would get)
      "regions": [                     // which provinces it owns; see matching rules
        { "iso": ["DEU"] },
        { "iso": ["POL"], "box": [14.0, 51.8, 19.0, 55.0] },
        { "iso": ["FRA"], "polygon": [[5.8, 49.6], [8.3, 49.0], [7.5, 47.5], [6.8, 47.8], [5.8, 48.6]] },
        { "iso": ["RUS"], "names": ["Kaliningrad"] }
      ]
    }
  ],
  "subjects": [["GBR", "CAN"]],        // [overlord, subject]: subject pays tribute, follows overlord into wars
  "treaties": [{ "type": "alliance", "a": "GER", "b": "AUH" }],   // alliance defensive nap access guarantee trade; directed types: a = grantor/guarantor
  "blocs": [{ "name": "Triple Alliance", "kind": "defense", "members": ["GER", "AUH", "ITA"] }],  // kind: defense | economic
  "rivals": [["FRA", "GER"]],          // [country, its rival]
  "wars": [{ "attackers": ["ITA"], "defenders": ["ETH"] }]   // wars already running at the start
}
```

## Region matching
- A rule matches a province when ALL given filters hold: `iso` (list of ISO-3 codes; omit = any
  country), `box` [lonMin, latMin, lonMax, latMax] on the province centroid, `polygon` (list of
  [lon, lat]; centroid inside), `names` (exact province names from the listing), `ids`
  (province ids). `exclude` is an optional list of sub-rules (same filters) that remove matches.
- Countries are processed in file order and a LATER country overrides an earlier one for the same
  province. So list big empires first and carve exceptions afterwards (or use exclude).
- Provinces that no country claims stay unowned: impassable land outside the states of the
  period. Use this honestly for regions without states in the period rather than inventing
  polities, but every province of a listed state should be covered.
- Borders are approximations at admin-1 resolution: assign each province to whoever held most
  of its area/population at the start date.

Country capitals must lie in or near an owned province. Dormant countries need regions too
(what they would get when released) and should be listed AFTER the country they would be
released from.

## Base mode (definitions built on an existing scenario)

A definition with `"base"` starts from an already built scenario instead of from region rules
alone (`buildFromBase` in `tools/build_history.mjs`). Flashpoint 2035 and Orbital Age 2085 are
built this way on top of `modern_2026`.

```jsonc
{
  "id": "orbital_age_2085", "name": "Orbital Age 2085", "era": "future",
  "startDate": "2085-01-01", "techYear": 2085,
  "fictional": true,                   // countries may start with technologies flagged fictional
  "base": "modern_2026",               // data/scenarios/<base>.json: countries, provinces, armies, diplomacy
  "keepDiplomacy": false,              // default true: keep the base's blocs/alliances, treaties and rivals
  "description": "…", "approximations": "…",
  "remove": ["FRA", "DEU"],            // base countries dropped; every province they owned must be taken by a regions rule
  "growth": {                          // population and GDP multipliers by FINAL owner
    "*": { "pop": 1.25, "gdp": 3 },    // default for owners not listed (if "*" is missing: 1 and 1)
    "EUF": { "pop": 0.85, "gdp": 2.1 }
  },
  "countries": [
    { "tag": "KOR", "name": "Korea", "armyK": 450, "regions": [{ "iso": ["PRK"] }], "techLag": 10 },
    { "tag": "EUF", "new": true, "name": "European Federation", "color": "#3a5fa8", "gov": "federal_republic",
      "capital": [50.85, 4.35], "flag": { "pattern": "h", "colors": ["#003399", "#ffcc00"] },
      "armyK": 1200, "regions": [{ "iso": ["FRA", "DEU"] }] },
    { "tag": "AFG", "techLag": 40 }
  ],
  "subjects": [], "treaties": [], "blocs": [], "rivals": [], "wars": []   // added on top of what is kept
}
```

- **Countries** start as copies of the base's (minus `remove`). An entry in `countries` changes
  an existing country: `name`, `color`, `gov`, `techLag`, `techYear`, `policies`, `stability`,
  `aggression`, `flag` and `techs` replace the base values when given. An entry with
  `"new": true` creates a country (it must not exist yet; `aggression` defaults to 0.3,
  `stability` to 60). An entry naming a tag that is not in the base and lacks `new` is an error.
- **Regions**: ownership starts from the base's provinces; then each listed country's `regions`
  (same matching rules as above) take provinces, in file order, so later entries win. Every
  remaining country must own at least one province, and no province may stay with a removed one.
- **Growth**: each province's population is multiplied by its final owner's `pop`; development
  moves by log(gdp ÷ pop) ÷ log(1.06), so GDP per head changes by gdp ÷ pop (clamped to 1–100).
- **Capitals**: `capital: [lat, lon]` picks the nearest owned province; otherwise a country keeps
  its base capital if it still owns it, else its most populous province. Capitals get fort ≥ 3.
- **Armies**: a country with `armyK` gets a new army (the same placement as normal definitions:
  newest land units at its technology year, 65/20/15% line/support/mobile, upkeep capped at a third
  of a typical tax revenue, stacks at the capital and largest provinces). Countries without
  `armyK` keep the base armies standing in provinces they still own (with the base's unit
  types), and a country left with no army gets a 5,000-man one.
- **Diplomacy**: with `keepDiplomacy` (default), the base's blocs (including its old-style
  `alliances`), treaties and rivals between surviving countries are kept, and the definition's
  `blocs`, `subjects`, `treaties` and `rivals` are added; with `false` only the definition's are
  used. Blocs keep only surviving members and are dropped below two. `wars` come only from the
  definition. Base-mode scenarios have no dormant countries (`releases` is empty).
- After building, `tools/build_forces.mjs` adds navies, air forces and strategic capabilities
  from `tools/forces/<id>.csv` if it exists (tools/forces/README.md), and `--economy` seeds the
  economy as for any scenario.
