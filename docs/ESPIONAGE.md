# Espionage

Spy networks work in every era (`src/core/espionage.js`; numbers in `balance.json` →
`espionage`). Cyber operations are a separate, modern capability with their own points
(STRATEGIC.md); both can steal research.

## Networks

In a foreign country's Nation tab, **Intelligence** shows your network there (0–100) and the
operations it allows.

- **Build network.** While ticked, the network grows 6 points a month, less the target's
  counter-intelligence. At most 3 networks are built at once. Each costs 0.4% of your tax revenue
  a month (at least 0.0005 B), shown as "Intelligence service" in the Economy tab budget.
- A network you stop building fades by 2 points a month.
- **Counter-intelligence** (your own Nation tab) costs as much as two networks. It cuts the growth
  of foreign networks in your country by 40% and makes their agents easier to catch. Autocracies
  get another 15% for free. You see which countries have networks in yours.

## Operations

Each operation spends network points. Its odds are shown on the button: success falls with the
target's counter-intelligence and rises with a full network.

| Operation | Network | Success | Caught | Effect |
| --- | --- | --- | --- | --- |
| Steal technology | 30 | 70% | 20% | 30% of the cost of a technology they know and you could research (the one you are researching, if they know it) |
| Sabotage industry | 25 | 65% | 30% | Two building levels lost in random provinces |
| Fund the opposition | 20 | 75% | 25% | −6 stability, −6 legitimacy |
| Stage a coup | 70 | 45%, more the shakier they are | 40% | Their government becomes yours (legitimacy 30, −10 stability) |

A coup needs their stability under 40 and no war between you. A country with at most half your
population that has no overlord or subjects becomes your **puppet** (a subject, DIPLOMACY.md).
The new government likes you (+40 opinion).

Agents caught (more likely when the operation fails) cost −30 opinion with the target and half of
the network.

## AI

Every few months an AI country with money to spare (a month of revenue banked) builds networks
in its rival and the leaders of its enemies in war. It steals technology from countries that know
more, sabotages and unsettles enemies at war, and stages a coup only against a weak neighbour it
could make a puppet (stability under 25). It turns counter-intelligence on once a foreign network
in its country reaches 30.
