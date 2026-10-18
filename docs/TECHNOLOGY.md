# Technology, research and eras (Milestone 5)

Code: `src/core/technology.js`. Rules: `data/rules/technologies.json` and the `research` section of
`data/rules/balance.json`. UI: the Research tab (key `A`), the technology tree overlay, the era in
the top bar and the Technology map mode (key `Q`).

## The tree

119 technologies in 13 eras (Ancient, Classical, Medieval, Renaissance, Early Modern,
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
| `fictional` | Speculative (Near Future and Future eras; 13 technologies). Never given at a scenario start |

Navy, air and space technologies exist so the tree is complete, but navies, air forces and space
arrive in Milestone 6: those technologies currently give only their general effects.

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
  the newest unit of each role (line, support, mobile). The **Modernise** button (Military tab,
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
its technology year. Prerequisites of anything known are added too. The technology year is the
country's `techYear` (else the scenario's `techYear`, else the start year), minus the country's
`techLag`. A scenario may also list extra `techs` per country.

## Saves

Save version 5 stores known technologies as one byte per country and technology, together with
the list of technology ids. Everything derived (multipliers, unlocked goods and buildings, era) is
rebuilt on load.

- **Changed technology file**: if a mod changes the file, known flags are remapped by id and
  research projects that no longer exist are dropped.
- **Older saves**: version 4 saves get the starting technologies of their scenario when loaded.
