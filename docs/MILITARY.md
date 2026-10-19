# Generals and battle plans

Combat itself (battles, combat width, organisation, sieges) is described in ARCHITECTURE.md
(Systems, Military) and the balance file; supply in LOGISTICS.md; fleets and air in NAVY_AIR.md. This page
covers who leads the armies and the orders the player can give a group of them. Numbers are in
`balance.json` → `commanders`.

## Generals (`src/core/commanders.js`)

Every army can be led by one general. At the first month of a game every army gets one; after
that, an army without a general takes the best one waiting in the country's pool each month.

- **Skill** 1–5: +5% damage per level, attacking and defending. New generals have skill 1 (60%),
  2 (30%) or 3 (10%).
- **Traits**, up to three:

  | Trait | Effect |
  | --- | --- |
  | Offensive doctrine | +12% damage when attacking |
  | Defensive doctrine | +12% damage when defending |
  | Mountaineer | +20% damage in hills and mountains |
  | Desert fox | +20% damage in deserts |
  | Woodsman | +20% damage in forests |
  | Winter expert | +20% damage in tundra |
  | Swift | moves 12% faster |
  | Organiser | organisation recovers 30% faster |
  | Inspiring | loses 15% less organisation in battle |
  | Logistician | ignores 40% of any supply shortage |
  | Engineer | sieges 30% faster |

- **Experience.** A battle won gives 0.35 experience, a battle lost 0.15. A general rises a skill
  level after `skill` experience (1 for level 2, 2 for level 3, ...). Each rise has a 40% chance
  of a new trait that fits the battle (terrain, attacking or defending).
- **Losses.** The general of a beaten army falls with a 4% chance, and is captured if the army
  surrenders.
- **Hiring** costs 5% of a month's revenue (at least 0.002 B). A country keeps at most one general
  per army plus two spares. The AI hires for leaderless armies when it has a month of revenue to
  spare.
- Merging armies keeps the most skilled general; the others wait in the pool.

In the Military tab each army card shows its general (hover for the details). With one army
selected you can give it any general, waiting or taken from another army.

## Battle plans (`src/core/plans.js`)

With armies selected, the Command section of the Military tab gives two kinds of plan:

- **Hold front against a country.** The armies spread along the provinces facing it (red ticks
  on the map), the provinces with the most enemy units next door first. Armies already on the
  line stay; threatened provinces left uncovered pull armies from quiet stretches. The plan
  re-checks every 5 days.
- **Plan attack.** Press it, then right-click the target: an arrow is drawn along the route.
  While the plan is prepared the armies gain attack, up to +15% after 30 days. **Execute** starts
  the advance: the armies march together one province at a time and only move on once the
  province ahead is taken. The bonus wears off by 1 point a day on the way. The plan ends when
  the target is taken.

An army is in one plan at most. Any other order (a right-click move, Stop) takes it out of its
plan. The AI does not use plans; its armies follow their own war logic (ARCHITECTURE.md).
