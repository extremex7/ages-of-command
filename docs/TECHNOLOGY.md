# Technology, research and eras (Milestones 5 and 6)

Code: `src/core/technology.js`. Rules: `data/rules/technologies.json` and the `research` section of
`data/rules/balance.json`. UI: the Research tab (key `A`), the technology tree overlay, the era in
the top bar and the Technology map mode (key `Q`).

## The tree

132 technologies (119 from Milestone 5, 13 added in Milestone 6) in 13 eras (Ancient, Classical, Medieval, Renaissance, Early Modern,
Enlightenment and Revolution, Industrial, Great War, World War, Cold War, Information Age, Near
Future, Future) and 13 fields (agriculture, administration, economy and industry, medicine,
education and science, transport, communications and computing, energy, army, navy, air, space,
doctrine). Each technology has:

| Field | Meaning |
| --- | --- |
| `era`, `field` | Placement in the tree |
| `year` | First historical use (negative = BC). Scenarios give countries every technology up to their technology year |
| `cost` | Relative cost, multiplied by the era's base cost |
| `req` | Prerequisites (cycles and unknown ids are rejected when the rules load) |
| `effects` | Bonuses: `farm mine industry research popGrowth combat movement siege devGrowth tax construction` |
| `unlocks` | `goods`, `buildings`, `units` (also named by each unit's `tech`), `govTypes` |
| `fictional` | Speculative (Near Future and Future eras; 17 technologies). Given at a scenario start only in scenarios marked `fictional` (the future scenarios) |

Since Milestone 6, navy, air and space technologies also unlock ships and aircraft (NAVY_AIR.md)
and strategic capabilities (STRATEGIC.md), on top of their general effects.

### Added in Milestone 6

| Technology | Year | Field | Prerequisites | What it does |
| --- | --- | --- | --- | --- |
| Submarines | 1900 | navy | Steamships, Internal Combustion Engine | Submarine flotillas |
| All-Metal Aircraft | 1933 | air | Powered Flight | Monoplane fighters, ground-attack and heavy bomber wings |
| Atomic Bomb | 1945 | army | Nuclear Fission | Nuclear warheads and programmes |
| Thermonuclear Weapons | 1952 | army | Atomic Bomb | Full warhead yield (fission yield is 0.35) |
| Ballistic Missiles (`icbm`) | 1959 | space | Spaceflight, Atomic Bomb | Missiles; ballistic missile submarines |
| Missile Defence | 1971 | army | Guided Missiles, Radar | +0.25 chance to intercept missiles |
| Stealth Aircraft | 1981 | air | Jet Engine, Integrated Circuit | Combat +0.02; stealth fighter and bomber wings, harder to intercept |
| Cyber Warfare | 2007 | communications | Internet | Cyber operations |
| Hypersonic Weapons | 2019 | army | Precision-Guided Munitions, Ballistic Missiles | −0.2 to the enemy's missile interception |
| Autonomous Weapons (**fictional**) | 2038 | army | Combat Drones, Machine Learning | Combat +0.05; autonomous armour, frigates and drone swarms |
| Quantum Encryption (**fictional**) | 2040 | communications | Quantum Computing | Doubles cyber defence |
| Orbital Defence (**fictional**) | 2058 | space | Directed-Energy Weapons, Orbital Industry | +0.3 missile interception; laser anti-satellite weapons |
| Off-World Settlement (**fictional**) | 2070 | space | Orbital Industry, Fusion Power | Settlements on the Moon and Mars |

Existing technologies gained new uses: Sailing, Ocean Navigation, Ship of the Line, Steamships,
Dreadnought, Aircraft Carrier, Guided Missiles and Nuclear Power unlock ships; Powered Flight,
Jet Engine, Helicopters and Combat Drones unlock aircraft; Spaceflight, Satellites and Satellite
Navigation (`gps`) allow satellites; Machine Learning, Quantum Computing, General AI and
Artificial Superintelligence raise cyber power. Fictional units: Directed-Energy Weapons unlocks
directed-energy artillery and the railgun cruiser, Powered Exoskeletons exoskeleton infantry,
Autonomous Weapons autonomous armour, frigates and drone swarms. Orbital Industry allows
stations, and Asteroid Mining adds their mining bonus.

### Fictional technologies

17 technologies are flagged `fictional`: Quantum Computing, Directed-Energy Weapons, Precision and
Vertical Farming (2035), Longevity Medicine, Quantum Encryption (2040), Autonomous Weapons (2038),
General AI (2045), Fusion Power (2050), Orbital Industry (2055), Orbital Defence (2058), Powered
Exoskeletons (2065), Asteroid Mining, Off-World Settlement (2070), Arcologies (2075), Molecular
Nanotechnology (2080), Radical Life Extension (2085) and Artificial Superintelligence (2090). They
are not counted in the normalisation below, and the AI values them 20% lower when choosing
research. Units that need them are flagged `fictional` too.

## Effects are normalised to the modern world

All economic, combat and growth formulas were calibrated in Milestones 1–4 for the 2026 world. To
keep that balance, each effect is applied relative to the sum of the same effect over every real
technology up to 2020:

```
multiplier = (1 + sum over known technologies) / (1 + sum over all real technologies up to 2020)
construction cost multiplier = the inverse of that ratio
```

So a 2026 country has multipliers of 1.0, a 1914 country has industrial output ×0.4–0.6, and a
Roman one ×0.2. Speculative technologies push multipliers above 1.

Multipliers act on: farm, mine and building output (`farm`, `mine`, `industry`), research points,
population and development growth, combat strength, army speed, siege progress, tax efficiency and
construction cost.

## What technology gates

- **Units**: a unit with a `tech` can only be recruited by countries that know it. The AI recruits
  the newest unit of each role (land: line, support, mobile; sea and air roles in NAVY_AIR.md). The **Modernise** button (Military tab,
  with armies selected) converts outdated units to the newest unit of the same role. It costs the
  price difference (at least 60% of the new unit's price) plus the extra men, and organisation
  drops to 30%. AI countries modernise one army at a time in peacetime when they have spare money.
- **Buildings**: need their technology to be built. Existing buildings keep working.
- **Goods**: a good a country has no technology for is not demanded by its population or its
  armies. Building inputs it cannot know are waived, so a pre-industrial farm needs no machinery.
- **Government types**: the format supports `unlocks.govTypes`, and a reform to such a type then needs
  that technology. The shipped tree gates no government type yet.

## Eras and manpower

A country's era is the latest era of an unbroken run of eras in which it knows at least half the
technologies. The era sets the share of the population that can be mobilised:

| Era | Manpower share |
| --- | --- |
| Ancient | 1.2% |
| Classical | 1.2% |
| Medieval | 0.8% |
| Renaissance | 0.8% |
| Early Modern | 1% |
| Enlightenment | 1.5% |
| Industrial | 2% |
| Great War | 4% |
| World War | 4% |
| Cold War | 1.5% |
| Information Age | 0.6% |
| Near Future | 0.6% |
| Future | 0.6% |

This share is then multiplied by the government's manpower factor. The Modern World keeps the
0.6% it had before technologies existed.

## Research

Each month, every country adds research points to its current project:

```
spending        = research share (default 5%, 0–25%) × tax revenue      (a budget line)
research points = 10 × √(spending ÷ price level) × education × research multiplier
education       = 0.3 + 0.7 × min(1.25, average development ÷ 80)
```

The square root keeps large economies from snowballing and gives roughly the historical pace. Over
20 simulated years from 1914, leading countries gained 6 technologies; 5 historical technologies
fall in that window. Rome gains about 3 technologies per century.

```
cost     = era base cost × technology cost × (1 − discount)
discount = 0.65 × (0.5 × share of living neighbours that know it + 0.5 × share of world GDP that knows it)
```

Era base costs: Ancient 100, Classical to Enlightenment 150, Industrial 160, Great War 180, World
War 220, Cold War 350, Information Age 600, Near Future 1,100, Future 1,800. Diffusion makes
catching up much cheaper than inventing.

- **No project**: points are banked, up to 12 months' worth. Banked points are spent at up to one
  extra month's worth per month.
- **Finishing**: points left over from a finished project are banked.
- **Switching**: switching projects keeps half the progress as banked points.
- **Queue**: holds up to 8 projects. Queueing a distant technology adds its missing
  prerequisites first.
- **Player**: if you have not chosen anything and there is something to research, a notification
  says points are being banked.
- **AI**: picks by value ÷ cost. Value is the sum of effects plus unlocks, weighted by what the
  country needs now: army and doctrine in war, agriculture when food is short, administration
  when unstable, and so on. Its choice is logged in the AI tab.

## Starting technologies

At a new game, every country knows every non-speculative technology whose year is at or before
its technology year (in scenarios marked `fictional`, speculative ones too). Prerequisites of anything known are added too. The technology year is the
country's `techYear` (else the scenario's `techYear`, else the start year), minus the country's
`techLag`. A scenario may also list extra `techs` per country.

## Saves

Save version 5 (and 6) stores known technologies as one byte per country and technology, together with
the list of technology ids. Everything derived (multipliers, unlocked goods and buildings, era) is
rebuilt on load.

- **Changed technology file**: if a mod changes the file, known flags are remapped by id and
  research projects that no longer exist are dropped.
- **Older saves**: version 4 saves get the starting technologies of their scenario when loaded.
