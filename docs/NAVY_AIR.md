# Navies and air forces (Milestone 6)

Code: `src/core/naval.js`, `src/core/air.js`, the sea parts of `src/core/military.js` and
`src/core/pathfind.js`, and the air and naval support in `src/core/combat.js`. Constants: the
`naval` and `air` sections of `data/rules/balance.json` (names in `code font` below). Sea data:
`data/map/seas.json`, built by `tools/build_seas.py`.

## Interface

- **Military tab** (`M`): an Army / Navy / Air switch for recruiting. Warships are built in the
  selected (or first) coastal province with a port, aircraft at a province with infrastructure.
  For warships and aircraft only the newest type of each role is listed, with a "Show older
  types" link. Fleet cards show ships, power, speed, strength, organisation, enemy power in the
  zone and the current order, with Merge, Split, Return to port and Stop. Air wing cards show
  aircraft, range, air / ground attack / bombing values, strength and a mission selector, with
  Merge and Rebase; selecting a wing highlights the provinces in its range.
- **Map**: fleets are drawn as hull markers with their ship count (at sea in their zone, or beside
  their port), air wings as one aircraft mark per country and base, and embarked armies with a
  hull line. Click to select; **right-click** a sea zone to sail there, a friendly port to dock,
  or (with wings selected) a province to rebase. Armies ordered overseas go by sea on their own.
  Hovering over the sea shows the zone and who controls it.
- **Naval map mode** (`S`): sea zones tinted by who holds them: yours, allies, enemies,
  contested (amber), other countries; open water stays plain.
- **Province panel**: fleets docked and wings based there. Naval battle reports open like land
  battle reports.

## Sea zones

`tools/build_seas.py` derives the oceans from Natural Earth 50m admin-0 land (public domain):

1. The world is rasterised on a **0.5° grid** (720 × 284 cells, latitudes −58° to 84°). A cell is
   water when its centre is not on land.
2. **99 named zones** grow from hand-placed seed points (one per sea, e.g. North Sea, Strait of
   Malacca, Hawaiian Waters). Each water cell joins the seed nearest by sailing distance
   (Dijkstra over water cells, 8 neighbours). Water no seed reaches (lakes, enclosed bays) stays
   unassigned.
3. **200 links**: two zones are linked when at least two of their cells touch (4-neighbour, so a
   diagonal sliver across land does not count), plus hand-listed straits and canals the grid is
   too coarse to see. A link's length is the great-circle distance between the two zone seeds.
   The builder fails unless every zone is reachable from the North Atlantic, except the Caspian
   Sea, which has no links.
4. **Ports**: every coastal province gets the (up to 3) zones with the most water cells within
   0.6° of its outline (1.5° if none), most cells first. 986 provinces have ports.
5. **Lanes**: each of the 444 straits and sea lanes of the province graph is assigned the zone
   it crosses (a zone both ends share, else the water nearest the midpoint).
6. The grid itself is saved run-length encoded. The game uses it to find the zone under a map
   point (`zoneAt` in `mapdata.js`), and the naval map mode will draw it.

### Chokepoints and canals

| Link | Zones | Commanding provinces (ids) | Opens |
| --- | --- | --- | --- |
| Danish Straits | Skagerrak – Baltic Sea | 635 | always |
| Strait of Gibraltar | Eastern Atlantic – Alboran Sea | 850 | always |
| Bosporus and Dardanelles | Aegean Sea – Black Sea | 2087 | always |
| Suez Canal | Levantine Sea – Red Sea | 707, 706 | 1869 |
| Bab-el-Mandeb | Red Sea – Gulf of Aden | 2317 | always |
| Strait of Hormuz | Persian Gulf – Gulf of Oman | 1038 | always |
| Singapore Strait | Strait of Malacca – South China Sea | 1915 | always |
| Panama Canal | Caribbean Sea – Gulf of Panama | 1560, 1561 | 1914 |

A link is closed to country *k* (`linkOpen`) before its opening year, or while any of its
commanding provinces is controlled by a country at war with *k*. Fleets, transports and route
planning all respect this. A fleet whose next link closes stops where it is.

## Ship units

Ships are units with `"domain": "sea"` in `data/rules/units.json`. One unit stands for `group`
real ships (10 galleys, 4 destroyers, 1 carrier…); `group` is used only by the forces builder.

| Role | Meaning | Units |
| --- | --- | --- |
| `capital` | Main battle line | galley, galleon, ship_of_the_line, ironclad, dreadnought, missile_cruiser, railgun_cruiser (fictional) |
| `screen` | Escorts: anti-submarine and anti-air, some raiding | frigate, cruiser, destroyer, missile_destroyer, autonomous_frigate (fictional) |
| `sub` | Diesel submarines | submarine |
| `nsub` | Nuclear attack submarines | nuclear_submarine |
| `ssbn` | Ballistic missile submarines (carry `warheads` tubes; see STRATEGIC.md) | ballistic_submarine |
| `carrier` | Carrier aviation (`air`) | carrier |

Sea stats besides `attack`, `defense`, `toughness`, `speed`: `asw` (finds submarines), `aa`
(anti-air, blunts carrier aviation), `stealth` (submarines), `raid` (commerce raiding), `shore`
(bombardment in support of land battles and landings), `air` (carrier aircraft) and `warheads`.
Ships use munitions and fuel like land units (`munitions`, `fuel`), and their `upkeep` is paid
with the army's.

## Fleets

A fleet is `{ id, owner, name, zone, port, units, str, org, exp, path, prog, battle, dock }`.
`port` is the province it is docked in (−1 at sea); `dock` is the port to enter at the end of
its path.

- **Building**: warships are recruited in an owned, controlled province with a port. A finished
  ship joins an idle fleet docked in that port or forms a new one at 60% organisation.
- **Orders** (`orderFleet`): sail to a zone, or to a friendly port (a port in a province the
  country or a friend controls and may enter; the route goes to whichever of its zones is
  the fewest links away). Routes are shortest paths in km over open links. Fleets merge when together, idle and of
  one country, and split in half.
- **Movement**: each day progress grows by speed ÷ max(50, link km). Fleet speed is its slowest
  ship's speed × (0.6 + 0.4 × fuel supply, if any ship uses fuel) × technology movement.
  Leaving harbour takes one day.
- **Ports**: a docked fleet repairs `repairDay` = 0.02 strength and recovers `orgRecoveryDay` =
  0.05 organisation a day; at sea organisation recovers at 40% of that and strength not at all.
  A fleet whose port is lost puts to sea.

## Sea control

Each day the game sums, per zone, the fleets **at sea** there (docked fleets do not count):

```
surface power = Σ ships (not submarines) × (attack + defense + 0.5 × air) × str × (0.4 + 0.6 × org)
```

- A zone is **hostile** to country *k* (`hostileSea`) when its enemies' surface power there is
  above zero and above *k*'s side's (its own and friendly fleets).
- The **controller** of a zone is the largest surface force there, if it is not outgunned by its
  enemies. Submarines never hold a zone.

Hostile water closes straits and sea lanes to land armies (pathfinding avoids them and an army
about to cross halts), blocks embarking and sailing transports, and cuts sea supply
(LOGISTICS.md).

## Naval battles

A battle starts in a zone where fleets at sea belong to countries at war. The defenders are the
fleet that arrived first and its friends, the attackers the fleets at war with them. Fleets that
arrive later join their side.

**Submarines.** A fleet made only of submarines (`sub`, `nsub`, `ssbn`) avoids battle unless
found. Each day it rolls against

```
detection = clamp(enemy asw ÷ (enemy asw + 3 × Σ stealth), 0.1, 1)
```

In battle, submarines fire harder the less they are found (attack × (1 + 0.5 × (1 − detection)))
and only take damage and sink in proportion to detection.

**Daily exchange** (`resolveNavalBattles`), each side against the other:

```
fire       = Σ ships × (0.35 + 0.65 org) × (1 + 0.25 exp) × technology × (0.6 + 0.4 munitions supply) × str
             × (attack, or the submarine bonus) + carrier air × air effect
air effect = own air ÷ (own air + 2 × enemy aa)
toughness  = Σ ships × toughness (× detection for submarines), at least 0.5
```

Fire is multiplied by a random 0.85–1.15. Each enemy fleet loses strength `damage` = 0.05 ×
fire ÷ toughness (more when its organisation is low: × (0.7 + 0.3 × (1 − org))) and organisation
`orgDamage` = 0.12 × fire ÷ ships. Ships **sink** in proportion to that loss: expected losses =
ships × loss × `sinkRate` (1.2) ÷ max(0.5, toughness ÷ 4), rounded randomly. A fleet with no
ships or strength ≤ 0.02 is gone.

A battle ends when one side is gone or its average organisation is below `breakOrg` = 0.2, or
after 20 days (higher organisation wins). Winners gain 0.05 experience; losers sail for the
nearest friendly port with organisation at most 0.1. The winning side's war score rises by
min(6, 1 + 1.5 × value of ships sunk). Every battle leaves a report with ships sunk, final
firepower and how much of each side's submarines were found.

## Blockades and commerce raiding

Monthly (`navalTrade`), for every country with ports, weighted by the number of its own
controlled port provinces on each zone:

```
blockade     = mean over its port zones of  enemy power ÷ (enemy power + own power + coastalDefence)
raiding      = mean over its port zones of  enemy raid ÷ (enemy raid + 2 × own asw + coastalDefence)
trade factor = max(0.1, 1 − blockadeTrade × blockade − raidTrade × raiding)
```

with `coastalDefence` = 5, `blockadeTrade` = 0.7 and `raidTrade` = 0.35. Raiding counts the
`raid` stat of enemy fleets at sea: submarines, but also cruisers and frigates. The trade factor
multiplies both the imports a country can buy and the surplus it can sell on the world market
that month (ECONOMY.md); a fully blockaded country keeps 10% of its trade. `econ.blockade`,
`econ.raid` and `econ.tradeFactor` are stored per country.

## Carriers and naval support of land battles

Warships at sea in one of a battle province's port zones support their side if their owner is
at war with the other side:

- carrier `air` adds 0.5 × air to the side's air power and 0.4 × air to its ground attack;
- `shore` adds bombardment, which always gets through (it is not reduced by air control).

See "Air combat over land battles" below for how these become damage.

## Armies at sea (amphibious movement)

`orderMove` plans a land route first. If there is none, or it takes more than 30 days, it also
plans a route that may go by sea (`findSeaPath`, A* over provinces and zones) and takes it if it
is faster than 0.67 × the land route.

- **Embarking**: only in a port the country or a friend controls, onto a zone that is not
  hostile: `embarkDays` = 3 days.
- **Sailing**: between zones over open links, not into hostile zones, at `transportKmDay` = 350
  km per day.
- **Landing**: on any coast of the zone the army may enter: 3 days. An army that lands counts as
  having crossed water, so a battle on arrival has the strait penalty for its first 5 days:
  attack × `combat.straitAttackPenalty` (0.6), eased by naval bombardment to at most
  0.6 + 0.4 × min(1, shore ÷ 10) × `landingSupport` (0.5) = 0.8.
- **At sea** (`a.sea` is the zone): armies do not fight, besiege, recover organisation or
  reinforce, and count as fully supplied. In a hostile zone transports lose `transportLossDay` =
  0.15 strength a day; below 0.05 the army is lost at sea. An army left at sea without orders
  heads for a friendly coast of its zone, or any coast it may enter.

Armies use no transport ships: any army can embark in a friendly port. Escorts matter only
through sea control.

## AI fleets

Every AI think (every `ai.thinkEveryDays` = 7 days, staggered):

- In peace, fleets return to the nearest friendly port.
- In war, a fleet below 50% strength or 35% organisation returns to port; a docked fleet below
  85% strength finishes repairs. Otherwise it searches zones up to 6 links away and goes to the
  best: a zone with enemy fleets it and its friends outgun by 1.3× (score 10 + enemy power), or
  an enemy coast to blockade where enemies are weaker than 0.7× its side (score = enemy coastal
  provinces, doubled for submarine fleets). Scores are divided by (distance in links + 1).
  Submarine-only fleets never seek battle, only coasts.
- Building: coastal countries keep a navy share of their military upkeep (below). The AI picks
  roles toward the mix capital 3 : screen 4 : nuclear sub 2 : sub 2 : carrier 1 (carriers only
  with GDP ≥ 1,500 B), always the newest unit of the role. **The AI does not build ballistic
  missile submarines**; it keeps those it starts with.

### AI force mix

The AI recruits in the domain furthest below its target share of military upkeep:

| Domain | Target weight |
| --- | --- |
| Land | 1 |
| Sea (countries with ports) | 0.25 + 0.15 × dev, + 0.15 when more than 60% of its provinces have ports |
| Air | 0.3 × dev |

with dev = min(1, average development ÷ 60). War odds count air power at 0.15× its strength
(`AIR_WEIGHT` in `ai.js`) on top of land power; naval power is not counted.

## Air wings

Aircraft are units with `"domain": "air"` and a `range` in km. One unit stands for `group`
aircraft (24 fighters, 12 bombers).

| Role | Default mission | Units |
| --- | --- | --- |
| `fighter` | superiority | biplane_fighter, monoplane_fighter, jet_fighter, stealth_fighter |
| `bomber` | idle (the AI switches it to bombing in war) | biplane_bomber, heavy_bomber, jet_bomber, stealth_bomber |
| `attack` | support | dive_bomber, attack_helicopter |
| `drone` | support | combat_drone, autonomous_swarm (fictional) |

Air stats: `air` (air-to-air), `attack` (ground attack), `bomb` (strategic bombing) and `range`.
`crewless` is recorded in the data but has no effect yet.

A wing is `{ id, owner, name, base, units, str, exp, mission }`.

- **Building**: aircraft are recruited in an owned, controlled province with infrastructure ≥ 1
  (`air.minInfra`, default 1; the key is not in balance.json). A new aircraft unit joins a wing of
  the same type at that base with fewer than 12 units, or forms a new wing.
- **Bases** (`canBase`): a province the country or a friend controls and that a friend owns.
  Rebasing is instant and costs 0.02 strength. A wing whose base is lost flies to the capital,
  or is destroyed if the capital cannot host it.
- **Range**: the shortest range among its aircraft; distance is measured from the base province
  to the target province (equirectangular km between centroids).
- **Missions**: `superiority`, `support`, `bombing` (needs bombers) or `idle`.
- **Repair**: +`repairDay` = 0.01 strength a day on days it did not fight.
- Wing strength never falls below 0.05 in combat, so wings are worn down but not destroyed by
  fighting. Wing experience exists in the data but is never gained yet.

```
wing stat = Σ aircraft × stat × str × technology combat multiplier × (1 + 0.2 × exp)
```

## Air combat over land battles

Each day of a land battle (`battleSupport`, `airCombatDay`), wings on `superiority` or `support`
in range of the battle province join the side they are friendly to (and at war with the other):

```
air power      = Σ wings: air × (1 on superiority, 0.4 on support)  + carriers offshore (0.5 × air)
ground attack  = Σ support wings: attack                              + carriers offshore (0.4 × air)
air share A    = air A ÷ (air A + air D)            (0.5 when nobody flies)
through A      = min(1, 2 × air share A)
extra damage A = (ground attack A × through A + shore bombardment A) × casDamage
```

`casDamage` = 0.12. The extra damage is added to the side's daily damage before the normal
battle formula. Wings lose `lossDay` = 0.01 × the enemy's air share in strength each day they
fight, 1.5× for support wings. A wing in range of several battles takes part (and takes losses)
in each. The battle report lists the air share and the extra damage of both sides.

## Strategic bombing

Monthly (`strategicBombing`), each wing on `bombing`:

1. **Target**: the enemy-held province in range with the most building levels plus 0.5 ×
   infrastructure.
2. **Bomb load** = wing `bomb` × precision, where precision = 1 + 0.25 × min(1, navigation
   satellites ÷ 4) + 0.15 × min(1, reconnaissance satellites ÷ 4).
3. **Interceptors**: every enemy wing on `superiority` in range of the target adds its `air`
   and loses `interceptorLoss` = 0.02 strength. Interception is cut by 60% × the share of the
   bomber wing's aircraft that are stealth types (technology `stealth`).
4. **Success** = bomb ÷ (bomb + 1.5 × interception + `groundDefence`), `groundDefence` = 4. The
   bombers lose `bomberLoss` = 0.12 × interception ÷ (interception + bomb + 1) strength.
5. **Damage**: ⌊bomb × success × `bombingLevels` + random⌋ building levels destroyed at random
   (`bombingLevels` = 0.08); with success above 0.5, a chance equal to success of −1
   infrastructure; the province's controller loses success × `bombingStability` (1.5)
   stability.

## AI wings

About every 28 days per country (with its depots): fighters fly superiority, bombers bomb in war
and idle in peace, other wings fly support (by the role of the wing's first aircraft type). In
war, a wing with no front-line province within 80% of its range rebases to the nearest
front-line province (one it controls that borders an enemy-held province). The AI builds toward
the mix fighter 5 : attack 3 : drone 2 : bomber 1.

## Saves

Fleets, wings and naval battles are saved (format v6). On load they are checked against the map
and rules: unit types of the wrong domain or removed by a mod, invalid zones, ports and bases are
dropped. Army paths keep their sea-zone nodes (ids ≥ the province count). Sea presence and zone
control are derived each day and never saved.

## Not done yet

- Transport capacity: any army can embark in a friendly port; there are no transport ships.
- Naval mines, coastal fortresses, port sizes and naval bases distinct from any coastal province.
- Air superiority missions over sea zones (air only acts over land battles and bombing targets),
  aircraft attacking fleets, and carrier wings as separate air units.
- AI amphibious invasion planning: the AI only goes by sea when its normal orders find the sea
  route faster.
- AI construction of ballistic missile submarines.
