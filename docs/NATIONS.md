# Nations: formable nations, national traits, advisors and missions

Four systems that give each country its own character and goals. Data:
`data/rules/formables.json`, `data/rules/traits.json` and `data/rules/nations.json` (formats in
[MODDING.md](MODDING.md)). Code: `src/core/nations.js` (traits, formables, the monthly step),
`src/core/advisors.js`, `src/core/missions.js`, `src/core/natfx.js` (combined effects); interface
in `src/ui/nation_ui.js` (Nation tab: traits, Decisions, Objectives; Government tab: Advisors).

Everything runs once a month (`monthlyNations`, after the AI's budget and before the country
caches and prestige). In a 196-country game it costs about 2 ms a month. All new state is
optional and filled in lazily, so older saves load without a migration. These systems never draw
from the game's random stream: their rolls come from a hash of the seed, the day and the country
(`hashRand`), so they cannot shift battle, event or AI rolls, and looking at a panel changes
nothing.

## National bonuses

Traits and advisors add up to one set of national bonuses (`nationalFx`), derived from the saved
lists and never saved:

| Effect | Meaning | Applied in |
| --- | --- | --- |
| `tax` | tax efficiency, +0.02 = 2 points | `govt.fx.taxEff` |
| `stability`, `legitimacy` | points added to their monthly targets | `govt.fx` |
| `manpower`, `construction` | ±share of the manpower cap, of construction cost | `govt.fx` |
| `research`, `combat`, `farm`, `growth`, `movement`, `siege` | ±share | `tfx.mult` (combat covers land, sea and air) |
| `industry` | ±share of factory output (not power plants and refineries, where a national edge only upset the world energy market in tests) | per-building multipliers in `tfx.bm` |
| `naval` | ±share of naval combat | `naval.js` |
| `trade` | share of the month's export value earned as revenue ("Trade income" in the budget) | `economy.js` |
| `influence` | diplomatic influence a month | `monthlyNations` |

## National traits

Each country has 1 to 3 traits (`c.traits`), 55 in all, with small effects (shares up to 15%,
points up to 6). Countries listed in `traits.json → tags` get theirs; the key `TAG@scenario` wins
over `TAG`, because tags mean different countries in different scenarios (AUS is Australia today
and Austria in 1444). Every other country gets `defaultCount` (2) traits from the default rules,
read in order; each matching rule adds one trait from its list, picked by a hash of the tag so the
pick is the same in every game. Rules test:

- the region of the capital: west, north and east Europe, the Middle East and North Africa,
  sub-Saharan Africa, South Asia, East Asia, Southeast Asia, the steppe, North America, Latin
  America, Oceania (`regionOf`, from the capital's latitude and longitude);
- the era (`eras: [first, last]`), population (`minPop`), average development (`minDev`);
- the share of coastal provinces (`coastal`) and of mountain provinces (`mountains`).

Traits are assigned when a game starts, when an older save is loaded, and in the first month for a
country that comes alive later (released or rebel states). Forming a nation adds its trait, so a
formed nation can have four. The Nation tab lists the traits with their effects in a tooltip, the
sum of all national bonuses, the prestige bonus and the nations formed.

## Formable nations

25 formable nations, from Germany, Italy, Spain, Great Britain, Russia, the Ottoman Empire, the
Polish-Lithuanian Commonwealth, Scandinavia, Yugoslavia, India and the Persian Empire to the Arab
League, Gran Colombia, the United Provinces of Central America, the East African Federation, a
restored Roman Empire and a European Federation. Each has:

- a **region** of provinces by ISO code (optionally a box or names: European Russia is Russia west
  of 60° E);
- **who may form it**: a country whose capital lies in one of `capitalIn`, or whose tag is in
  `tags`; never a tag in `is` (those already are the nation: DEU is Germany);
- an **era range** (for example the Ottoman Empire from the Medieval to the World War era, the
  European Federation only from the Cold War era), and optionally the government families allowed
  (the European Federation needs a democracy).

A country may form it when it owns at least `need` of the region's provinces (60–90%), is not a
subject, has stability 25 or more, and nobody else is that nation (a living `is` country or one
that formed it). Forming:

- renames the country, may change its colour, and sets its flag: a real flag file where there is
  one (`de`, `it`, `eu`, `hist/ottoman`…), with `flagEras` giving an older flag before an era (the
  German Empire's flag before the World War era, then today's; the flag changes with the era), or
  the drawn pattern flag;
- adds the nation's trait, a prestige bonus (3 to 15 points), +10 stability and +10 legitimacy;
- claims every province of the region the country does not own yet, so the AI (and the player)
  have a reason to finish the job. Claims last 30 years like other claims.

The **Decisions** section of the Nation tab lists the nations the country could form with a
progress bar (own N of M provinces), the reason it cannot yet, a list of the missing provinces
(click one to see it on the map) and the **Form** button with the rewards in its tooltip. The
player is told once when a nation becomes possible. An AI country that qualifies forms it with a
50% chance each month (`forming.aiChance`); objectives (below) steer AI wars toward the region.

Better than Age of History: the decision shows exactly what is missing, forming adds claims rather
than land, and era and government limits keep a modern "Ottoman Empire" or a medieval European
Federation out of the game.

## Advisors

Five kinds, at most one of each: treasurer (tax efficiency and trade), marshal (combat and
manpower), chancellor (influence and legitimacy), natural philosopher, from the Industrial era
chief scientist (research), and chief minister (stability and cheaper construction). Each has a
skill of 1 to 5 that multiplies the kind's `perSkill` effects; a skill-3 treasurer adds 3 points
of tax efficiency and 1.8% of export value as trade income.

Seats depend on the government type: 2 for a military government, 4 for federal and
parliamentary republics and one-party states, 3 for the rest. After a change of government,
advisors beyond the seats leave, the least skilled first.

Salary: (0.002 + 0.25% of revenue) × skill a month, in the budget as "Advisors"; hiring costs six
months of salary. Candidates: six at a time (one of each kind and one more), with skill 1 (45%), 2
(30%), 3 (17%), 4 (6.5%) or 5 (1.5%), aged 28 to 62, drawn from the seed, the country and the
year: the pool changes every 12 months and a hired candidate leaves it.

Every month advisors age; one past the retirement age he was hired with (62–76) retires; the
monthly chance of death is 0.0007 × e^((age − 50)/9) (about 1% a year at 50, 8% at 70); and there
is a 15% a year chance of rising one skill level. The player is told of retirements, deaths and
promotions.

AI countries look every third month: with a free seat, a treasury above the hiring cost plus two
months of revenue and a budget that can carry the salary, they hire the candidate worth most to
them (skill × need: the treasurer counts double in deficit, the marshal at war, the chief minister
below stability 45). Deep in debt they dismiss the least useful one. In three years of AI play about
60% of countries hire at least one.

## Missions (objectives)

Every country keeps up to three objectives (`c.missions`), each with a deadline and a reward
fixed when it is given. Kinds, drawn from the country's situation:

| Kind | Offered when | Done when | Years | Reward |
| --- | --- | --- | --- | --- |
| Break free | a subject | no longer a subject | 30 | prestige +5, stability +10 |
| Clear the debt | treasury below zero | treasury back above zero | 6 | stability +4, prestige +1 |
| Restore order | stability below 45 | stability 60 | 5 | legitimacy +6, 2 months of revenue |
| Form a nation | owns 35% or more of a formable region it may form | it is formed | 25 | prestige +3, 6 months of revenue |
| Take back a province | holds a claim on a province of a non-ally | owns it | 10 | prestige +2, stability +5 |
| Humble the rival | the rival is a neighbour | owns one of the rival's (up to 6) border provinces next to it | 12 | prestige +4, claims on the rival's border provinces |
| Ally a neighbour | the strongest neighbour with opinion of it 25 or more, not allied | allied (alliance, defensive pact or bloc) | 6 | prestige +1, stability +3, influence +15 |
| Enter the next era | not in the last era | in it | 30 | prestige +3, 4 months of revenue |
| Grow the economy | always | GDP 15–30% above the start | 8 | prestige +2, 3 months of revenue |

A new objective is picked among the kinds not active and not ended in the last 18 months, weighted
by urgency (break free 5, debt and order 4, forming and claims 3, rival 2.5, alliance 2, era 1.5,
growth 1). The player gets one a month while fewer than three are active, AI countries every third
month. Finished objectives pay their reward; expired ones, or ones that can no longer be done (the
nation was formed by someone else, the target is gone), are dropped. The player is told of new and
completed objectives; the Objectives section shows each with its progress, deadline and reward.

The AI pursues them loosely: a claim, rival or forming objective adds 0.25 to its war motive
against the country holding the province, the rival, or part of the region (`missionMotive` in
`ai.js`); an alliance objective makes it offer an alliance, or else a defensive pact, twice a
year when the other side would accept.

## Prestige bonus

Forming a nation and completing objectives add prestige bonus points (`c.prestigeBonus`). They
are added to the 0–100 prestige score (at most 15 points, the score stays at most 100) and fade by
1.2% a month (half in about four years). The leaderboard tooltip shows them.
