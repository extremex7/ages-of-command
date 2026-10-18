# Logistics and supply (Milestone 6)

Code: `src/core/supply.js`, with effects in `combat.js` and `military.js`. Constants: the `supply`
section of `data/rules/balance.json` (names in `code font`) and `combat.supplyWeight`.

Every land army has a **supply level** `a.supply` between 0 and 1, recomputed daily. It is
separate from the munitions and fuel stockpiles of Milestone 3 (ECONOMY.md), which still weaken
units when the country runs short of those goods; both apply.

**Interface**: a supply bar on every army card (red below 50%, the attrition line), a note on
armies at sea when enemy fleets hold their waters, the **Supply map mode** (`W`, your supply level
per province, red to green, grey where none reaches), and in the province panel the province's
supply capacity and a Build / Remove supply depot button with its cost and the depots in use.

## Supply maps

For each country *k* the game builds a map of supply level per province (`supplyMap`).

**Sources**

| Source | Level |
| --- | --- |
| A province *k* controls and owns | home supply = min(1, `homeBase` + `homePerInfra` × infrastructure) = min(1, 0.75 + 0.025 × infra) |
| A province an ally (friendly country) controls and owns | home supply × `alliedSource` (0.9) |
| A supply depot of *k* in a province it controls | at least `depot` = 0.85 |
| A coast reachable by sea (below) | `sea` = 0.55, + `seaEscorted` = 0.15 if *k*'s side has surface ships at sea in that zone |

**Sea supply.** If *k* controls at least one of its own port provinces, every sea zone that is
not hostile to *k* (NAVY_AIR.md, "Sea control") carries supply. A coastal province controlled by
*k*, a friend or an enemy of *k* that is still below 0.55 gets the best value of its port zones;
enemy-held coasts get it × `enemyStep` (0.85). Neutral coasts get no sea supply.

**Spreading.** From every source, supply flows to neighbouring provinces, keeping the best value
found:

```
next = current × (stepBase + stepPerInfra × infra of the next province)      0.78 + 0.02 × infra
             × waterStep  if the step crosses a strait or sea lane              × 0.85
             × enemyStep  if the next province is enemy-held                   × 0.85
```

- Supply does not spread **out of** an enemy-held province: it reaches one step into enemy land.
- It does not cross a strait or sea lane whose waters enemy fleets hold.
- It passes through neutral land only where *k* has military access.
- It stops spreading below `floor` = 0.12.

## An army's supply

```
supply = max(minimum, level × crowding)                                  minimum = 0.1
level  = home supply of its province, if the country owns and controls it and is at peace;
         else the province's value on the country's supply map;
         1 for armies at sea
crowding = min(1, capacity ÷ friendly land units in the province)
capacity = stackBase + stackPerInfra × infra + stackPerDev × development  = 8 + 3 × infra + 0.15 × dev
```

Crowding counts the units of every friendly army in the province, not only the country's own.

## Effects

| Effect | Rule |
| --- | --- |
| Combat | Each army's damage × (1 − `supplyWeight` + `supplyWeight` × supply) = × (0.5 + 0.5 × supply). Battle reports list both sides' average supply when below 95% |
| Organisation | Daily recovery × supply (and × the communications-satellite bonus, STRATEGIC.md) |
| Reinforcement | No monthly reinforcement while supply < `low` (0.5) |
| Attrition | While supply < `low` and not in battle: strength − `attritionDay` × (1 − supply ÷ low) per day (up to 0.006), never below 0.02. The player is warned once when an army falls below 50% strength this way |

## Depots

A depot makes a controlled province a supply source at 0.85, which is how an army pushing deep
into enemy land keeps up.

| Rule | Value |
| --- | --- |
| Where | Any province the country controls (occupied enemy land included) |
| Limit | `depotsBase` + ⌊GDP ÷ `depotPerGdp`⌋ = 2 + ⌊GDP ÷ 1,500 B⌋ |
| Cost | `depotCost` × price level = 0.4 B × price level, no upkeep |
| Loss | Monthly, depots in provinces the country no longer controls are removed |

Core functions: `canBuildDepot`, `buildDepot`, `removeDepot`, `maxDepots`, `depotCost`.

**AI depots** (about every 28 days, with its air wings): at peace the AI removes all its depots.
At war it finds its worst-supplied land army below `low` + 0.15 (65%) and builds a depot in that
army's province if it controls it, otherwise in the adjacent controlled province with the best
infrastructure (+2 if it is occupied enemy land). At the limit it first removes its oldest
depot. The reason is logged in the AI tab.

## Refresh and the saved supply cache

Building a supply map for every country every day would be too slow, so maps are cached in
`state.supplyCache` and rebuilt when any of these change:

- the period: ⌊day ÷ `refreshDays`⌋, with `refreshDays` = 5;
- `state.supplyVer`, bumped when a depot is built, removed or lost;
- `state.relVersion`, bumped when relations change (a war starts or ends, an alliance, access).

Captured provinces and changes in sea control are read when a map is built, so they show at the
next refresh, up to 5 days later. A country's map is built the first time an army of it needs
one in the period. At peace, armies in their own provinces read home supply directly and need no
map.

**Why the cache is saved.** Maps are quantised to bytes (0–255, read back through a 256-entry
lookup table) and saved with the game. A map built on day 2 of a period and a fresh map rebuilt
on day 4 after loading can differ (a province changed hands in between), so a reloaded game
would drift from the running one. Saving the maps makes a reloaded game read exactly the values
the running game would, which the save/load determinism test checks. On load the saved maps are
kept if every map has one byte per province and was built for the saved relations version;
otherwise they are dropped and rebuilt.

## Not done yet

- Supply has no goods cost: depots and supply lines do not consume food, munitions or fuel
  beyond the Milestone 3 national stockpiles.
- No transport capacity per railway or port, no supply for fleets or air wings (fleets use the
  national fuel and munitions supply).
- Supply maps do not distinguish rail from road; both are folded into infrastructure.
