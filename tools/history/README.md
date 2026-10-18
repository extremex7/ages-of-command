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
