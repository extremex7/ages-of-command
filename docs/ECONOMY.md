# Economy (Milestone 3)

The economy connects population, development, resources, buildings, trade, construction and
the budget. Code: `src/core/industry.js` (production, market, construction),
`src/core/economy.js` (budget, stability, growth), `src/core/state.js` (`provinceGdp`).
Data: `data/rules/goods.json`, `data/rules/buildings.json`, `balance.json → industry`.
Money is in billions (B). Quantities of goods are abstract "units"; each good has a base price
in B per unit.

## Monthly order

On the first day of each month:

1. **Production.** Each building runs at an efficiency set by its province. Power plants run
   first, then the rest in the order of `buildings.json`, so mines run on this month's energy and
   farms and mines produce before the factories that consume their output.
2. **World market.** Each country sells stock above its target and buys what it lacks.
3. **Consumption.** Armies take munitions and fuel first; the population consumes the rest.
4. **Effects.** Satisfaction feeds into GDP, stability, population, development, unemployment,
   prices and army supply. World prices adjust.
5. **Budget.** Taxes, tariffs and spending are applied to the treasury (see "Budget" below).

Construction advances daily.

## Power

Energy comes from six kinds of plant (`buildings.json`):

| Plant | Energy per level | Needs | Technology |
| --- | --- | --- | --- |
| Thermal (coal) power plant | 3 | 1.5 coal | Electric Power |
| Hydroelectric dam | 2.5 | nothing; a hydro deposit (rivers in hills and mountains) | Electric Power |
| Gas power plant | 3 | 1 natural gas | Gas Turbine |
| Nuclear plant | 6 | 0.15 uranium; development 55 | Nuclear Power |
| Wind farm | 1.2 × wind | nothing | Renewable Energy |
| Solar farm | 1.2 × sunshine | nothing | Renewable Energy |

Wind and sunshine (about 0.3 to 1.4) come from each province's terrain, latitude and coast
(`siteMap` in `src/core/industry.js`): deserts and the tropics are sunniest, coasts, plains and
the far north windiest. Gas fields need a gas deposit. Gas and hydro deposits were added to every
scenario by `tools/add_energy_deposits.mjs` (gas from approximate national production shares,
hydro from terrain plus countries with large hydro resources); the starting buildings are
unchanged, so the starting energy mix is still all thermal and nuclear, and new plants change it
from there. With several ways to make a good, the AI ranks them by monthly value per unit of cost
at its best site, counting a short input at twice its price, so it builds dams and wind where
sites are good and coal where coal is cheap.

## Goods

There are 15 goods:

- **Raw:** food, timber, coal, oil, natural gas, iron ore, uranium and rare earths.
- **Industrial:** steel, energy and fuel.
- **Final:** consumer goods, electronics, machinery and munitions.

### Demand

**Population demand** per month is:

```
demand = population (millions) × demand × (productivity / productivity at development 80) ^ incomeExp
```

`incomeExp` controls how fast consumption of a good grows with income:

- Food, with 0.5, grows slowly with income.
- Electronics, with 1.0, grows in step with income.

**Army demand** comes from your units:

| Source | Need per month |
| --- | --- |
| Every unit | 0.05 munitions |
| Every unit, for each day it fights | 0.03 munitions |
| Every armoured unit | 0.15 fuel |

**Industrial demand** is what your buildings need as inputs at full capacity. **Construction**
also takes goods; that use is smoothed and added to need.

## Buildings and efficiency

Each building level has, per month at 100% efficiency:

- outputs and inputs;
- a number of workers;
- a cost and a build time;
- the goods it consumes when construction starts;
- a maximum level.

Some buildings have extra requirements:

- **Mines and oil fields** need a deposit in the province, and their level cannot exceed the deposit size.
- **Farms** scale with farmland quality, which is estimated from terrain and latitude.
- **Nuclear plants** need development 55; **electronics plants** need development 35.

The efficiency of a building in a province is:

```
efficiency = workforce × infrastructure × building factor            (0 if occupied)
workforce       = min(1, industrial workforce / workers needed)      industrial workforce = 25% of population
infrastructure  = 0.70 + 0.04 × infrastructure level (0–10)
building factor = development efficiency                    for factories and plants
                = 0.5 + 0.5 × development efficiency        for mines and oil fields
                = farmland × (0.4 + 0.6 × development eff.)  for farms
development efficiency = clamp(sqrt(1.06 ^ (development − 80)), 0.15, 1.2)
```

Input shortages come on top of this. A building type's national output is scaled by its scarcest
input:

```
output factor = min over inputs (stockpile / input still needed by this and later buildings)
```

A short input is shared in proportion to need: when coal covers half of what power plants and
steel mills together want, both run at half rather than the power plants taking it all.

Every province panel shows this calculation in its tooltips.

## World market

- **Stockpile target.** Each country aims to keep:

  ```
  target = this month's population and army use + need × stockMonths
  ```

- **Sellers and buyers.** Stock above the target is offered for sale. Stock below the target is
  bought, but the amount is reduced by half the importer's tariff rate.
- **Who gets what.** Each exporter `x` offers the share `r[x] = surplus / reachable deficits` to
  every importer it can reach. An importer offered more than it needs scales all offers down by
  `s[y]`. So the flow from `x` to `y` is:

  ```
  flow(x → y) = r[x] × deficit[y] × s[y]
  ```

  The market runs twice per good to place leftover surpluses.
- **Closed routes.** War or an embargo, by either side, closes a route.
- **Performance.** The totals are computed without looping over every pair of countries, so the
  market costs O(exporters + importers + closed routes) per good.
- **Price.** Importers pay the world price. Their tariff is paid to their own treasury.
- **World prices** follow the ratio of world need to world supply, compared with the ratio at the
  scenario start:

  ```
  supply = production + 10% of stocks
  price  = base × (ratio / start ratio) ^ 0.6
  ```

  The price is then clamped to 0.3–4× base, and moves 35% of the way toward its target each month.
- **Embargoes.** You can embargo any country from its Nation tab. AI countries do not declare
  embargoes yet.

## Effects

| Effect | Rule |
| --- | --- |
| GDP | See "GDP" below |
| Stability target | −24 × food shortage, −12 × consumer shortage, −0.6 per point of unemployment above 6%, −0.4 per point of inflation above 5% (max −15) |
| Population growth | base rate × (2 × food supply − 1); below 50% food the population shrinks further |
| Development growth | 0.02 per month × living standard × (civil share / 0.75) × max(0.2, 1.3 − development/100) |
| Unemployment | 4% + workers idled by missing inputs or occupation + 12% × energy shortage + 4% × consumer shortage |
| Consumer prices (CPI) | basket at world prices × (1 + tariff × import share) × (1 + 0.6 × shortage), relative to the start |
| Price level | development-based level × CPI; scales unit costs, upkeep and construction |
| Combat | damage × (0.6 + 0.4 × munitions supply); armour also × (0.5 + 0.5 × fuel supply) |
| Movement | armies with armour move at speed × (0.7 + 0.3 × fuel supply) |
| Infrastructure | +4% building efficiency and +5% movement speed into the province per level |

## GDP

Province GDP has two parts, services and industrial value added:

```
GDP = population × 400 × 1.06^development × calibration × (1 − share of workforce in industry) × supply
      + industrial value added × 12
supply      = (0.55 + 0.45 × energy supply) × (0.9 + 0.1 × fuel supply)
value added = outputs − inputs, at world prices
```

The calibration factor is set once at the start so that every province's GDP equals the
scenario's. The economy only changes GDP from there.

## Budget

Each month:

```
revenue = taxes + tariffs + requisitions
net     = revenue − civil spending − military upkeep − interest
```

Construction is paid up front from the treasury when a project starts.

## Construction

- **Cost.** Each level costs `cost × (1 + 4% per existing level) × price level`, plus its goods
  taken from the stockpile. Goods you lack are bought at 1.5× the world price.
- **Infrastructure** costs more for larger provinces and for higher levels.
- **Slots.** The number of projects that advance at once is 2 + 0.5 per trillion of GDP, up to 20.
  Further projects wait in the queue, which holds up to 30 projects.
- **Occupation.** Projects in occupied provinces pause. Projects in provinces you lose are cancelled.
- **Cancelling** refunds 50% of the cost.
- **Capture.** Buildings stay with the province when it changes hands.

## AI

Every other month each AI country:

1. Keeps a reserve: at least 0.75 months of revenue or 4 months of military upkeep, whichever is
   larger (`ai.buildReserveRevenueMonths`, `ai.buildReserveMilitaryMonths`). Mines may go down to
   0.25 months (`ai.mineReserveRevenueMonths`), since their exports pay them back quickly.
2. Ranks goods by the value of the gap between need (padded 5% to build ahead of growing demand,
   `ai.buildHeadroom`) and production plus what is already being built. Energy gaps count triple
   (`ai.energyPriority`): a shortage cuts GDP and idles every factory. Munitions come first when
   its armies are short of them.
3. Builds the producer of the top good in the province where a new level would be most efficient.
   If one of the producer's inputs is below 90% supplied (`ai.bottleneckBelow`), it builds that
   input's producer instead, following the chain (consumer factory → steel mill → iron mine) so it
   does not build a mill that would stand idle for want of ore. A country with unused deposits
   also takes its share of any world shortage of a raw material (world price at least 5% above
   base, `ai.worldShortagePrice`; share = its part of the world's unused deposits) and mines it
   for export, since importers without deposits cannot. Large economies start up to a third of
   their free construction slots at once, and a large gap can take several levels.
4. With nothing missing, improves infrastructure where most of its industry is.

In peacetime an AI country keeps a small surplus for construction: below 4% of revenue (with
under 6 months of revenue banked) it raises taxes a point at a time, up to 27% (`ai.investSurplus`,
`ai.investTaxCap`), and it recruits or re-equips units only while a month of revenue stays in the
bank (`ai.peaceRecruitReserveMonths`).

When its budget runs a deficit with little money left, an AI country first raises taxes (to 34%),
then trims civil spending (to 60%). If it is still in deficit at peace with debt above two months
of revenue, it retires its costliest unit (army unit, ship or aircraft unit) each AI round until
the budget balances.

Decisions and reasons appear in the AI tab.

## Starting economy (`tools/build_economy.mjs`)

The builder sizes the starting economy so that world output roughly meets world need at the
start. It reuses the game's own demand and efficiency functions:

- **Deposits.** For oil, coal, iron ore, uranium and rare earths, the builder takes each country's
  share of world production in `tools/resource_table.csv` (rounded public estimates for c. 2023).
  It sizes the deposits to world need and spreads them over provinces by terrain affinity.
  Timber deposits come from forests.
- **Finished goods.** Output of finished goods follows each country's own need × a
  specialisation factor from the same table. For example, Taiwan has 4× electronics, Argentina
  2.5× food and Germany 2× machinery.
- **Placement.** Building levels go to provinces weighted by population and efficiency, within
  each province's workforce, deposits and maximum levels.
- **Value-added cap.** Industrial value added is capped at 70% of a country's GDP; farms are exempt.
- **Iteration.** The builder iterates until world output reaches ~103% of need for every good.

`node tools/econ_report.mjs [years]` prints world supply and demand, prices and national
indicators at the start and after N years of AI play. It is used to check the calibration.

## Known simplifications

- Electricity from gas, hydro and renewables is folded into the "thermal power plant" (coal input).
- Goods are national pools. There is no transport inside a country and no shipping distance in
  trade.
- Trade is automatic. There are no trade agreements, and the AI does not embargo.
- Value added is priced at world prices. Domestic prices only enter through CPI.
- Population demand ignores inequality. Living standard is a national average.
