# Strategic capabilities (Milestone 6)

Code: `src/core/strategic.js`, with hooks in `ai.js` (deterrence), `ai_diplomacy.js` and
`diplomacy.js` (arms control), `industry.js` (nuclear winter, fallout, space output),
`technology.js` (space research), `combat.js` and `military.js` (satellites), `air.js` (bombing
precision) and `events.js`. Constants: the `strategic` section of `data/rules/balance.json`
(names in `code font`). Money is in billions (B); costs are multiplied by the country's price
level.

Each country's capabilities live in `c.strat` (warheads, missiles, programme, launch on warning,
cyber points and power, satellites by kind, stations, settlements, space project, disruption,
launches this month). World-wide consequences live in `state.strategic` (detonations, nuclear
winter, orbital debris, fallout by province, queued retaliation).

**Interface**: the **Strategic tab** (`Z`) shows warheads, programme target, delivery means,
deterrent, missile defence and strategic upkeep, with a programme selector and a launch-on-warning
checkbox; cyber points, power and defence, with the four operations and their odds against the
country selected on the map; a satellite table with coverage and Launch buttons, anti-satellite
strikes against enemies with satellites, space projects; and the world's detonations, nuclear
winter farm output, debris, fallout and nuclear powers. A **Nuclear strike…** button appears in
the province panel of enemy-held provinces when you have warheads; it pauses the game and opens a
confirmation naming the delivery, interception chance, first-use and retaliation consequences.
Every action calls a core function that validates and returns a reason when it is not allowed.

> **Fiction.** Technologies flagged `fictional` in `data/rules/technologies.json` are
> speculative and are marked **(fictional)** here: Quantum Computing, General AI, Artificial
> Superintelligence, Quantum Encryption, Directed-Energy Weapons, Orbital Industry, Orbital
> Defence, Asteroid Mining, Fusion Power, Off-World Settlement and the others listed in
> TECHNOLOGY.md. Their effects are game rules, not predictions.

## Nuclear weapons

**Technologies**: Atomic Bomb (1945) allows warheads; Thermonuclear Weapons (1952) give full
yield; Ballistic Missiles (`icbm`, 1959) allow missiles and missile submarines; Missile Defence
(1971) and Hypersonic Weapons (2019) change interception; Orbital Defence (2058, **fictional**)
adds space-based lasers.

**Programmes** set the arsenal a country builds towards:

| Level | Target warheads |
| --- | --- |
| none | 0 |
| minimal | 20 |
| deterrent | 200 |
| large | 1,500 |
| massive | 6,000 |

A scenario's starting warheads choose the largest level whose target they already meet (at least
minimal; e.g. 290 → deterrent, 3,600 → large). The arsenal is kept as it is, not built up toward
the next level; warheads above a programme's target are only dismantled under arms control.

**Building** (monthly): while below target, a country adds
min(target − warheads, ⌈`buildMonth` × (1 + GDP ÷ 3,000)⌉) warheads (`buildMonth` = 3), limited by
its uranium stockpile (`uraniumPerWarhead` = 0.002 units each) and by its treasury above one
month's revenue (`warheadCost` = 0.02 B each). Arsenals above the target are kept unless an
arms-control treaty applies. With Ballistic Missiles it also builds missiles up to
⌈warheads ÷ `warheadsPerMissile`⌉ (3 warheads per missile), at most `icbmBuildMonth` = 4 a month,
`icbmCost` = 0.08 B each.

**Upkeep** (monthly, a separate `strategic` line of the budget): `warheadUpkeep` = 0.00005 B per
warhead, `icbmUpkeep` = 0.0004 per missile, plus satellites, stations and settlements below.

## Delivery

A strike on a province needs, in this order of preference:

1. **Ballistic missiles** (`icbm` > 0): unlimited range; one missile is used per strike.
2. **Missile submarines at sea**: any ballistic missile submarine (role `ssbn`) of the country
   that is not docked. It has 16 `warheads` tubes, but the tubes are not consumed by strikes;
   they only need to exist.
3. **A wing with any bomb load** whose base is in range of the target (the one with the largest
   bomb load). This includes ground-attack wings and drones, whose `bomb` is above zero.

A country **has a deterrent** (`hasDeterrent`) when it has warheads and at least one of: a
missile, a missile submarine at sea, or any wing with a bomb load. Missile submarines at sea
(`seaLaunchers`) survive a first strike, as nothing targets them.

## Interception

- **Bombers**: the strike fails with chance interception ÷ (interception + 3 × wing bomb load + 1),
  where interception is the `air` of enemy superiority wings in range of the target.
- **Missiles and submarine launches**: chance =
  `missileDefence` (0.25, with Missile Defence) + `warningIntercept` × warning-satellite cover
  (up to 0.1) + `orbitalDefence` (0.3, with Orbital Defence, **fictional**) − `hypersonic` (0.2,
  if the attacker has Hypersonic Weapons), clamped to 0 – `maxIntercept` (0.75).

An intercepted strike still uses the warhead and still counts as nuclear use (opinion, stability
and retaliation below), with no damage.

## A strike

Only provinces held by an enemy at war with the striker can be struck. Yield Y = 1 with
Thermonuclear Weapons, else `fissionYield` = 0.35.

| Effect | Amount |
| --- | --- |
| Population killed | pop × min(0.85, `popLoss` × Y), `popLoss` = 0.55 |
| Development | − `devLoss` × Y (25 × Y), at least 1 left |
| Infrastructure | − round(`infraLoss` × Y) (6 × Y) |
| Fort | destroyed |
| Each building level | lost with chance `buildingLoss` × Y (0.6 × Y) |
| Armies in the province | strength × (1 − 0.8 Y), organisation 0 |
| Wings based there | strength × (1 − 0.9 Y) |
| Fleets docked there | strength × (1 − 0.7 Y) |
| Neighbouring land provinces | population × (1 − `neighbourPopLoss` × Y) (4%) |
| Fallout | the province's farms produce nothing for `falloutMonths` = 24 months |
| War score | striker's side + `strikeWarScore` × Y (6 × Y), within the war-score cap |

**Reactions** (also for intercepted strikes):

- **First use** (the target never struck the striker before, and this is not a retaliation):
  every other country gets a −`firstUseOpinion` (−60) opinion modifier of the striker (decaying
  0.5 a month), and the striker loses `firstUseStability` = 8 stability.
- The target gets −100 opinion of the striker (decay 0.2) and loses `struckStability` × max(0.3,
  Y) stability (6 × Y).
- **Counterforce**: unless at least half of the target's warning-satellite cover is in place,
  `counterforce` = 5% of its missiles are destroyed in their silos.

## Launch on warning and retaliation

If the struck country still has a deterrent, it retaliates **the next day** with
`retaliationStrikes` = 2 strikes on the striker's most valuable provinces (by population and
development), unless the struck country is the player and has turned launch on warning off
(it is on by default). A retaliation does not itself trigger another retaliation, but each side
can keep striking by its own decision.

## Deterrence and escalation in the AI

- **War decisions** (`considerWar`): when the target or any of its expected joiners has a
  deterrent, the AI attacks only if it has a deterrent itself, its motive is at least one point
  above what it needs, and a 20% roll succeeds. Otherwise it looks elsewhere.
- **Use** (monthly): an AI country with warheads at war uses one only when its survival is at
  stake: more than `aiNukeOccupied` = 40% of its provinces occupied, or its capital lost. Chance
  per month = `aiNukeChance` (0.15) × (0.5 + aggression), × 0.05 if the enemy can retaliate (× 0.3
  instead if the capital is lost and more than half the country occupied). The target is the
  enemy with the most troops on its soil: first its largest army stack on the AI's own land
  (tactical use), otherwise its most valuable city.
- **Programmes**: once a year (staggered), an AI country that knows Atomic Bomb, has none, has a
  nuclear-armed rival, GDP above `aiProgrammeGdp` = 400 B and aggression above 0.35 starts a
  minimal programme with 25% chance.

## Arms control treaty

A mutual treaty (`arms_control`) between two countries that both have warheads, proposable like
the other treaties.

- While it holds, both countries' programme target is capped at `armsControlCap` = 1,550 warheads,
  and an arsenal above the target shrinks by `dismantleMonth` = 2% a month down to it.
- **Acceptance** adds to the usual opinion and trust terms: base −5 ("Verification and lost
  flexibility"), +15 "Slows a costly arms race", +10 if the proposer is above the cap, −20 if the
  receiver is above the cap and the proposer is not.
- **AI**: a nuclear power without such a treaty proposes one to the largest arsenal it is not at
  war with, if that arsenal is more than half its own and their opinion is above −40.

## Nuclear winter

Each detonation adds Y to `state.strategic.winter`, which decays by `winterDecayMonth` = 3% a
month. Farm output everywhere is multiplied by

```
farm multiplier = max(1 − winterMaxFarmLoss, 1 − winter × winterFarmPerYield) = max(0.4, 1 − 0.004 × winter)
```

so 100 thermonuclear detonations cut world farm output by 40%, the maximum 60% cut takes 150.
Hunger then works through the Milestone 3 food rules (ECONOMY.md).

## Cyber operations

Needs **Cyber Warfare** (2007); a target without **Internet** cannot be attacked (its defence is
infinite).

```
cyber technology = 1 + 0.3 Machine Learning + 0.5 Quantum Computing* + 1 General AI* + 1 Artificial Superintelligence*
cyber power      = cyber technology × √(monthly research spending) × cyberPowerScale (3)       (monthly)
cyber points    += cyber power × cyberPointsPerPower (1), up to cyberMax (100)
defence          = (target's cyber power + cyberBaseDefence (2)) × 2 with Quantum Encryption*
success          = clamp(power ÷ (power + 1.2 × defence), 0.1, 0.9)
identified       = clamp(0.15 + 0.5 × defence ÷ (power + defence), 0.1, 0.9)
```

\* fictional technologies.

| Operation | Cost (points) | Effect on success |
| --- | --- | --- |
| Espionage | 20 | Steals `stealShare` = 25% of the cost of a technology the target knows: the current project if the target knows it, otherwise the cheapest available one, as banked research points |
| Sabotage | 30 | Up to `sabotageLevels` = 2 building levels destroyed in random provinces of the target |
| Disruption | 25 | For `disruptionMonths` = 2 months the target's industry output ×0.9 and research ×0.8; −2 stability |
| Disinformation | 15 | −`disinfoStability` (4) stability, −`disinfoLegitimacy` (3) legitimacy |

Success and identification are rolled separately. If identified, the target gets a
−`cyberOpinion` (−25) opinion modifier of the attacker, whether the operation worked or not.

**AI** (every other month, staggered): with at least 15 points, against a random enemy at war
(sabotage half the time when it can afford it, else disruption) or, in peace, its rival
(espionage if the rival knows more technologies, else disinformation). It acts with chance
aggression + 0.2.

## Satellites

Four kinds. All need **Spaceflight**; recon, comms and warning need **Satellites**, navigation
needs **Satellite Navigation** (`gps`). Each costs `satCost` = 0.6 B and `satUpkeep` = 0.004 B a month. A country may make
`launchesMonth` = 2 launches a month, +1 per orbital station.

Cover per kind = min(1, satellites of that kind ÷ `satCoverage`), `satCoverage` = 4: four
satellites of a kind give the full effect, more add nothing.

| Kind | Effect at full cover |
| --- | --- |
| Reconnaissance (`recon`) | Land combat +4%; strategic bombing precision +15% |
| Communications (`comms`) | Army organisation recovery +20% |
| Navigation (`nav`) | Army speed +5%; strategic bombing precision +25% |
| Early warning (`warning`) | Missile interception +0.1; with at least half cover, missiles are not destroyed by a first strike |

**AI**: a country that knows Satellites, with GDP above `aiSatGdp` = 600 B and a treasury above 4
months' revenue, keeps up to min(4, ⌊GDP ÷ 600⌋) satellites of each kind, launching the kind it
has fewest of.

## Anti-satellite weapons and debris

Needs **Guided Missiles** and **Satellites**; only against a country at war with you, at most one
strike a day. It targets the first kind the enemy has, in the order warning, recon, nav, comms.

| Weapon | Hit chance | Debris added |
| --- | --- | --- |
| Kinetic | `asatHit` = 0.6 | `debrisKinetic` = 1 |
| Laser (with Orbital Defence, **fictional**) | `asatLaser` = 0.85 | `debrisLaser` = 0.2 |

**Debris** threatens everyone: each month every satellite in the world is destroyed with chance
debris × `debrisRisk` (0.002), and debris decays by `debrisDecayMonth` = 0.4% a month. The AI
fires at an enemy's satellites with 30% chance a month while at war.

## Space projects (fictional)

Both projects need **fictional** technologies. A country runs one project at a time; cost is paid
at the start.

| Project | Technology | Cost | Time | Upkeep | Max | Effects each |
| --- | --- | --- | --- | --- | --- | --- |
| Orbital station | Orbital Industry (2055) | `stationCost` = 60 B | 12 months | 0.3 B/month | 5 | Industrial building output +3%; research +3%; +1 satellite launch a month; with Asteroid Mining (2070), mine output +5% |
| Off-world settlement | Off-World Settlement (2070) | `colonyCost` = 150 B | 24 months | 0.8 B/month | 3 | Research +6%; +3 stability when completed |

**AI**: with a treasury above 8 months' revenue and no project, it starts a station, or a
settlement if it cannot build a station.

## Events and scenarios

- `data/events/strategic.json` (19 events, any scenario): the bomb debate, nuclear tests, broken
  arrows, false alarms, arms talks, nuclear-winter fears after 5 detonations, reactor accidents,
  satellite collisions, ASAT tests, solar storms, station milestones, the first child born off
  Earth, ransomware, grid blackouts, zero-days, quantum advantage, a rogue AI and navigation
  jamming. Their conditions use the new keys below.
- New condition keys: `warheads`, `satellites`, `worldNukes` (detonations so far), `hasNukes`.
  New effect keys: `warheads`, `satellites` (spread over the kinds the country can build),
  `cyber`, `stations`, `colonies`. Warhead, station and settlement effects need the technology.
- Scenarios set starting `warheads`, `icbm`, `sats` (by kind), `stations` and `colonies` per
  country; each is installed only if the country knows the matching technology at the start.
  The values come from `tools/forces/<id>.csv` (tools/forces/README.md). In Orbital Age 2085 the
  space powers get their stations and settlements from opening events.

## Saves

`c.strat` and `state.strategic` are saved (format v6). The v5 → v6 migration gives every
country empty capabilities and the world no detonations: an old game continues with none, and
countries can build them from then on. Unknown satellite kinds are dropped on load.

## Not done yet

- Warheads are not assigned to launchers: missile submarine tubes and bomber loads are not used
  up, and missiles are not targeted by counterforce beyond the 5% rule.
- No tactical nuclear weapons distinct from strategic ones, no civil defence, no radiation
  effects on armies passing through fallout.
- No cyber attacks on military units, satellites or nuclear command.
- Satellites have no orbits or coverage regions; cover is national.
- Space projects have no location and cannot be attacked.
