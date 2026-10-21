# Religion, unrest, revolts and golden ages

Four linked systems that make the inside of a country matter (Session 23). Code:
`src/core/religion.js`, `src/core/unrest.js`, `src/core/ages.js`, with setup and the monthly order
in `src/core/society.js`. Data and every number: `data/rules/society.json` (each section has a
`_doc`). Interface: `src/ui/society_ui.js`, map modes in `src/map/modes.js`.

They sit below the civil wars of [GOVERNMENT.md](GOVERNMENT.md). A civil war splits a whole
country in two when its government collapses; a revolt is local. A few provinces rise, rebels
take land and the government sends troops. Only separatists who hold out make a new country, and
then only from the land they hold.

## State

Everything is optional and created lazily (`ensureSociety`), so saves from before this session
load without a migration and `SAVE_VERSION` did not change. An old save is seeded from the rule
table for its current year.

- `state.society`: per-province typed arrays (saved as base64 like the other province fields):
  - `rel` (Uint8, religion index, 255 = none)
  - `conv` (Float32, progress toward the state religion)
  - `unrest` (Float32, 0-100)
  - `core` (Int16, the owner the province belongs to by right)
  - `since` and `last` (when the current owner took it)
  - `supp` (Uint8, crackdown left)
  - the list of `revolts`, and `ids`, the religion ids, so a changed religion list is remapped by id
- `c.soc` holds each country's:
  - `rel` (state religion id) and `warEx` (war exhaustion 0-100)
  - `unrest`, `misShare` and `faith` (people-weighted averages)
  - `age` (`{kind, start, until}`), with the age counters `gold`, `dark`, `pEma` and `recover`
  - `parts` (its stability contributions)

## Religions and seeding

There are 13 religions in 8 families:

| Family | Religions |
| --- | --- |
| Christian | Catholic, Orthodox, Protestant (needs the printing press to adopt) |
| Islamic | Sunni, Shia |
| Dharmic | Hindu, Buddhist |
| East Asian | East Asian traditions |
| Jewish | Jewish |
| Iranian | Zoroastrian |
| Pagan and folk | Roman and Hellenic paganism, folk and tribal religions |
| Secular | Secular (needs the scientific method) |

Each religion has a name, family and map colour.

**Provinces.** Province religions come from `provinceRules`, an ordered list (later rules win)
matched by:

- year range (`from`, `to`)
- modern country (`iso`)
- province names (`names`)
- a lon/lat `box`
- an optional `share`, which covers that fraction of matching provinces, picked by a fixed hash

196 rules give, for example:

- Hellenic Rome and a Jewish Judaea in 117, with Zoroastrian Iran.
- Catholic Europe, Orthodox Balkans and Sunni Iran in 1444, before the Safavids.
- A Protestant north and a split Germany in 1815.
- A secular share in Western Europe, East Asia and the former Soviet bloc from 1990, which grows
  in the later futures.

**State religions.** `stateRules` give state religions by scenario and tag, or by capital country
and years. Examples: Protestant Britain and Scandinavia from 1530, secular France from 1905,
secular communist states between 1917 and 1991. Otherwise a state takes the majority faith of its
heartland, the owned provinces in its capital's modern country. That way colonial empires keep
their metropole's faith, so Britain does not become Hindu.

**Scenario overrides.** A scenario can fix any of this:

```json
"religion": { "states": { "OTT": "sunni" }, "provinces": { "orthodox": [812, 813] } }
```

## Effects

**Unrest.** A province of another faith adds unrest of
`mismatchUnrest (18) × family factor × policy factor`:

- The family factor is 1 for a different family, 0.6 for the same family and 0.5 when either side
  is secular.
- The policy factor comes from the government's Religion policy, which is also the tolerance
  setting:

| Religion policy | Unrest | Stability loss | Conversion |
| --- | --- | --- | --- |
| State religion | ×1.5 | ×1.2 | ×2.5 |
| Religious tolerance | ×0.55 | ×0.5 | ×1 |
| Secular state | ×0.75 | ×0.6 | ×0.6 |

**Stability.** The stability target loses `10 × share of people of other faiths × the policy's
stability factor`. A state religion policy with nearly everyone in the faith adds up to +2 for
unity.

**Opinion.** Two countries with the same state religion get +8 opinion, and +3 if they are in the
same family. Different families get −6 when either has the state religion policy or is a
theocracy. Secular states take no part in any of this. The term shows as "Religion" in the
diplomacy opinion breakdown.

**Conversion.** Each month, a province the owner controls moves toward the state religion. With
civil spending at the reference level it takes about 70 years, and that pace changes as follows:

- ×2.5 under the state religion policy
- scaled by civil spending relative to 75% of the budget
- ×1.6 within the same family
- slowed by unrest, and stopped at unrest 60 or more

A secular state does not proselytise; developed provinces drift to secular slowly. The province
panel shows the progress and the years left.

**Changing the state religion.** This is a government decision on the Government tab, an "Adopt"
button beside each faith in the religious make-up.

- Requirements:
  - at least 10% of the people already follow the new faith
  - its technology, if any (Protestant, Secular)
  - not a theocracy
  - 25 years since the last change
- Costs:
  - 10 stability and 15 legitimacy
  - a "Change of faith" modifier that angers the clergy (−20 approval) for 5 years
  - conversion progress starts over

## Province unrest

Each month a province's unrest (0-100) moves 15% of the way toward the sum of these parts. The
province panel's tooltip lists them.

| Part | Amount |
| --- | --- |
| Stability | (50 − stability) × 0.4 |
| Other religion | As above |
| Recent conquest (owner is not the core) | 22, falling over 50 years to a floor of 25% |
| Separatism (a living former owner or a dormant nation claims it) | +6 |
| War exhaustion | × 0.25 |
| Taxes | (tax − 20%) × 60 |
| Hunger | (1 − food satisfaction) × 25 |
| Civil spending | −(share − 70%) × 30 |
| Garrison | −4 per unit of the owner's land units in the province, up to −20 |
| Crackdown | −25, fading by 2.5 a month |
| Capital | −10 |
| Golden or dark age | −8 or +8 |

Restless provinces pay less tax: 0.4% less per point, and nothing while rebels hold them. A
country's average unrest above 15 lowers its stability target by 0.15 per point.

**War exhaustion** (0-100) grows by:

- 1 a month at war
- 4 × the share of the country that is occupied
- 1 more while losing (war score below −20)

It fades by 6% a month in peace. It adds unrest, takes 0.05 per point from the stability target,
and counts toward a dark age.

**Lowering unrest** (player and AI):

- garrison troops in the province
- raise civil spending or cut taxes
- switch to religious tolerance
- **Suppress unrest** in the province panel: −15 unrest at once and the −25 crackdown above. It
  costs 5% of a month's tax revenue and 1 legitimacy, and only one crackdown can run in a
  province at a time.

## Revolts

A province the owner controls with unrest of 40 or more may rise:

- Chance each month: 8% × (unrest − 40)/60.
- At most one new revolt per country a month, and 3 at once.
- The kind is the largest cause:
  - **religious** (another faith)
  - **separatist** (conquest and separatism), named after the nation that claims the land
  - **popular** (stability, war, taxes, hunger)
- Size: 1 unit plus one unit per million people × unrest/100, up to 20, using the country's own
  best line infantry.

Rebels are not a country; they are an entry in `state.society.revolts`. A band:

- **Besieges** its province for 25 days, plus 15 a fort level, then holds it. Held provinces are
  striped dark red on the political map, and the band's counter is drawn on the map.
- **Moves on** to the most restless neighbouring province it can take, preferring land of its
  faith or its claimed nation.
- **Grows** with the unrest of the land it holds.
- **Fights back.** Any army of the country standing in the band's province fights it daily:
  - Strength is shared by power. Rebel power is units × (attack + defence) × strength × 0.75,
    × 1.25 in hills, mountains and forest.
  - Rebels lose up to 5% strength a day and the army takes small losses.
  - Below 15% strength the band is **crushed**: −10 unrest in its provinces and a little military
    glory.
- Armies retake held provinces the band has left by standing in them.

**Winning.** A band that holds land wins:

- **Religious and popular revolts**, after 12 months, force concessions:
  - religious tolerance, or 5% lower taxes
  - −10 legitimacy and −4 stability
  - the rebels go home
- **Separatists**, after 18 months, declare independence. The new country starts with a truce
  with its old ruler, a capital, a treasury and an army made from the band. The cases:
  - a dormant nation is released, with its other restless provinces
  - the land rejoins a living former owner
  - a new country "Free \<province\>" (tag `SEP1`, `SEP2`, ...) is formed

Each revolt costs 2 stability, plus up to 15 more in proportion to the share of the people the
rebels hold.

## Golden and dark ages

**Golden ages.** A golden-age month needs:

- stability of 65 or more and unrest under 15
- food and goods at 95% or more
- an economy that is not shrinking
- prestige above its 3-year average
- not losing a war

Each such month adds one to the momentum, and a month that fails takes two away. At 24 a golden
age may begin, with these limits:

- 2.5% a month, in peace
- once every 60 years
- never while 6% of countries already have one

It lasts 15 years, or ends early if stability falls below 30. Effects: research ×1.15, population
and development growth ×1.25, stability +5, unrest −8.

**Dark ages.** A crisis month is any one of:

- stability under 30
- food under 85%
- inflation over 15%
- war exhaustion over 50
- rebels holding land

At 18 crisis months a dark age may begin, at 5% a month and once every 30 years. Effects: research
×0.85, growth ×0.75, stability −5, unrest +8. It lifts after 12 months with stability of 55 or
more, or after 10 years.

Both are announced in the log and with an event the country answers (`golden_age`, `dark_age` in
`data/events/society.json`, marked `triggered`, so they never fire at random). The Government
tab shows the age, the golden momentum (with the reason a month does not count) and the crisis
months.

## AI

Monthly, for every AI country (and the player's when automated):

- **Revolts.** The AI sends the nearest idle armies until it has 1.6 × the rebels' power. At war
  it spares only nearby armies unless the rebels hold land. These armies are marked `quell`, so
  the war AI leaves them alone until the revolt ends. While its budget is positive, it also
  orders up to two crackdowns a month in provinces with unrest of 42 or more.
- **Tolerance.** A state religion policy turns to tolerance when there is a religious revolt or
  more than 10% of the people follow other faiths. A tolerant country with under 5% minorities and
  a clergy of over 12% support may make the faith official again. The ordinary policy AI then
  leaves the Religion policy alone for 10 years.
- **Religion.** The AI checks every 5 years. If under 12% follow the state faith, 60% or more
  follow another, the country is stable (40+) and at peace, and it is not a theocracy, it adopts
  the majority faith. It changes only within the same family of faiths, unless the old faith was
  pagan or the new one is secular.

## Interface

- **Map modes.** Religion (key 6) colours provinces by faith, darker where the province does not
  share its owner's state religion; the legend lists the faiths on the map. Unrest (key 7) runs
  from calm through restless (20) to revolt risk (40+), with held provinces dark red. Both
  recolour monthly.
- **Province panel.** Religion (with conversion), unrest with a breakdown tooltip and bar, any
  revolt (siege progress, strength, months to its demands), and Suppress unrest.
- **Nation tab.** State religion and its share of the people, average unrest and revolts, and any
  golden or dark age.
- **Government tab.** Religion and unrest:
  - the tolerance setting and its multipliers
  - the religious make-up with Adopt buttons
  - war exhaustion and the stability effect
  - the revolt list (click to go there)
  - golden and dark age status and momentum
- **Map markers.** Rebel bands are drawn as dark red counters with their size.

## Performance

All per-province work is monthly: one pass each for conversion, unrest and spawning, using typed
arrays. Daily work happens only while revolts exist, and only for the armies standing with them.
The held-province mask and the dormant-claim map are cached until revolts or countries change.
Map-mode colours reuse the renderer's monthly recolour. Setup takes about 200 ms at the start of a
game, and the monthly step adds a few milliseconds.
