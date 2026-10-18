# Government and domestic politics

Rules live in `data/rules/governments.json` (types, factions, policies) and the `government`
section of `data/rules/balance.json` (all the tuning numbers). Code: `src/core/government.js`,
domestic events in `src/core/events.js`. Everything runs monthly except events (checked once a
month per country, spread across days).

## Government types

| Type | Family | Elections | Stability | Tax eff. | Manpower | War propensity | Coup risk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Presidential republic | Democracy | 4 years | +0 | ×1.00 | ×1.0 | 0.8 | 0.6 |
| Federal republic | Democracy | 4 years | +3 | ×0.95 | ×1.0 | 0.7 | 0.5 |
| Parliamentary republic | Democracy | 4 years | +2 | ×1.00 | ×0.95 | 0.6 | 0.4 |
| Constitutional monarchy | Democracy | 5 years | +4 | ×1.00 | ×0.95 | 0.6 | 0.3 |
| Absolute monarchy | Autocracy | none | +2 | ×0.95 | ×1.0 | 1.0 | 0.8 |
| One-party state | Autocracy | none | +3 | ×1.05 | ×1.2 | 1.1 | 0.5 |
| Military government | Military rule | none | −3 | ×0.90 | ×1.4 | 1.3 | 1.5 |
| Theocratic republic | Theocracy | none | +1 | ×0.90 | ×1.2 | 1.1 | 0.7 |

Each type also has a base legitimacy, a liberty level (used by the liberty driver), starting
faction support, default policies and the types it can reform into (`reformsTo`). Autocracies
name a fixed ruling faction.

The **family** sets how governments regard each other (a diplomacy opinion term): democracies
like democracies (+15) and dislike the rest (−15 to −20); autocracies like each other (+10).

The effects of the type, policies and active modifiers are combined into `govt.fx` (derived,
recomputed on load, never saved): tax efficiency (clamped 0.6–1.3 overall), manpower, construction
cost, coup risk, stability, legitimacy, liberty and per-faction approval.

## Factions

Seven factions: liberals, conservatives, socialists, nationalists, business, military, clergy.
Each holds a share of **support** (sums to 1) and has an **approval** of the government (0–100).

Approval moves 15% a month toward a target:

```
target = approvalBase (40) + approvalSpread (30) × tanh(Σ weight × driver) + 15 if ruling + effects
```

Drivers, each roughly −1…+1: low taxes, civil spending, military spending, prosperity (living
standard), peace (−1 at war, +0.2 at peace), military glory (recent victories), liberty, order,
faith and state planning. Each faction weighs them differently (for example socialists want civil
spending and planning, business wants low taxes and markets, the military wants defence and
glory). The Government tab's tooltip on each faction shows every term.

Support drifts 2% a month back toward the government type's base and slightly toward factions
with approval above 50; elections move it faster.

## Legitimacy and stability

Legitimacy moves 5% a month toward the type's base + policies + 0.4 × (approval − 50). An election
adds 10. The government adds to the monthly stability target (see ECONOMY.md):

```
type and policy stability + 0.25 × (approval − 50) + 0.1 × (legitimacy − 70)
```

## Elections

Democracies vote every `electionYears`. Each electable faction gets
`support × (0.4 + 1.2 × approval / 100)` of the vote; support swings halfway toward the result,
and the largest faction becomes the ruling faction.

## Coups and revolutions

Monthly coup chance (only with a military faction):

```
0.06 × coup risk × min(1, military support × 4) × (40 − military approval)/40 × (45 − stability)/45
```

A coup installs a military government (legitimacy 30, −8 stability).

A revolution can only happen below stability 22, when more than 45% of the population backs
factions with approval under 30. The chance scales with that share and how low stability is. The
largest unhappy faction installs its preferred government type. Coups and revolutions share a
3-year cooldown.

## Policies and reforms

Five policy groups, three options each: conscription (volunteer, limited, mass), press (free,
regulated, censored), economy (market, mixed, planned), administration (centralised, balanced,
decentralised), religion (secular, tolerant, state). Each option has effects (faction approval,
tax efficiency, manpower, construction cost, liberty, stability, legitimacy). Changing one costs 4
legitimacy and 2 stability and then waits 180 days.

A reform switches to one of the type's `reformsTo` types: in peacetime, stability ≥ 40, once every
5 years; it costs 12 stability, sets legitimacy to 45 and resets policies to the new type's
defaults.

The AI reviews two policy groups a year and adopts an option when it raises the
support-weighted approval target (the ruling faction counts double), also valuing manpower at
war and money in deficit. It does not reform its government type.

## Domestic events

`data/events/*.json` (listed in `data/events/index.json`). 17 events: general strike, corruption
scandal, military demands, mass protests, food riots, inflation crisis, war weariness, rally round
the flag, election promises, coup plot, regional autonomy, tech boom, natural disaster, religious
revival, refugees, border incident, economic miracle.

Each event has a mean time to happen (`mtth`, months), a cooldown and conditions. Once a month per
country, eligible events are pooled: the country rolls once with the combined chance (at most 60%)
and one event is picked by weight. The player gets a dialog and 30 days to choose (then advisers
pick, as for the AI); AI countries pick by the `ai` weights on each option. File format: see
[MODDING.md](MODDING.md).
