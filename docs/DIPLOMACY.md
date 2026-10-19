# Diplomacy

Tuning numbers: the `diplomacy` section of `data/rules/balance.json`. Code:
`src/core/diplomacy.js` (treaties, opinion, trust, proposals), `src/core/relations.js` (the fast
relation matrix the movement and war code read), `src/core/war.js` (joining wars, peace terms),
`src/core/ai_diplomacy.js` (AI).

## Opinion, trust, reputation, influence

**Opinion** (−100…100) is computed on demand, never stored, from:

| Term | Value |
| --- | --- |
| Government families | −20…+15 (see GOVERNMENT.md) |
| Each treaty | alliance +25, defensive pact +20, guarantee +15, NAP +10, trade +10, access +5; a subject −10 toward its overlord |
| Shared organisation | +20 |
| At war / recent war | −80 / up to −15, fading over the truce |
| Shared border (not allied) | −5 |
| Our rival / treats us as a rival | −35 / −15 |
| Military threat (stronger neighbour, not allied) | up to −20, more if they are aggressive |
| Embargo either way | −15 |
| Common enemy / common rival | +20 / +10 |
| Holds land taken from us (claims) | −3 per province, up to −30 |
| Their reputation | 0.15 × reputation |
| Decaying modifiers | declared war on us −50, attacked an ally −20, broke a treaty −40, peace grievances −40, improved relations +15 (stacks to 45), refused proposals… each fades 0.5 a month (grievances 0.25) |

**Trust** (0…100) = 50 + 0.4 × reputation + up to 20 for years of kept treaties + 10 if allied +
modifiers (breaking a treaty: −40).

**Reputation** (−100…100) falls when a country breaks treaties (alliance 30, defensive 25,
guarantee 25, NAP 20, access and trade 5) or declares an unjustified war (5). It recovers 0.4 a
month toward 0. A war is justified against your rival, a holder of
your claims, or your overlord (independence).

**Influence** is earned monthly (0.5 + 0.035 × √GDP, at most 2.5, capped at 100) and spent on
"Improve relations" (10 influence, +15 opinion fading 0.5 a month).

Every opinion and trust value in the UI has a tooltip listing these terms.

## Treaties

| Treaty | Direction | Effect |
| --- | --- | --- |
| Alliance | mutual | Join each other's defensive wars; troops may pass |
| Defensive pact | mutual | Join when the other is attacked |
| Non-aggression pact | mutual | Breaking it costs reputation 20, stability 5, trust 40 |
| Trade agreement | mutual | No tariffs between the partners (see ECONOMY.md) |
| Military access | grantor → receiver | Receiver's armies may enter the grantor's land |
| Guarantee | guarantor → protected | Guarantor joins if the protected is attacked; needs no acceptance |
| Subject | overlord → subject | Subject pays 10% of revenue as tribute, follows the overlord into war, has no foreign policy of its own; made only in peace treaties |
| Reparations | payer → receiver | 10% of the payer's revenue for 5 years; made only in peace treaties |

A country may hold 8 treaties (peace-treaty obligations do not count). A treaty must last 365 days
before it can be ended without penalty; ending it earlier counts as breaking it. Declaring war
breaks every treaty with the target, with the costs above.

**Organisations** (blocs): defence blocs (NATO, CSTO) act like alliances between all members;
economic blocs (EU, Mercosur, EAEU, GCC) remove tariffs between members. Applying needs a yes vote
from two thirds of members, each voting yes when its opinion of the applicant is at least 30.

## Proposals

A proposal is accepted when the target's score is above 0. The score starts from a base
(alliance −40, defensive −25, access −15, NAP −10, trade −5) plus 0.5 × opinion and
0.3 × (trust − 50), then type-specific terms: shared rival +25, strength added, being at war,
friendship with your rival, democracies' reluctance toward non-democracies, border security for
NAPs, market size and the ruling faction's view of trade, and so on. The proposal buttons in the
relations section show the full breakdown before you click. A refused proposal of the same kind
cannot be repeated for 180 days.

## War, allies and peace

Declaring war calls in the target's defence-bloc partners, allies, defensive-pact partners,
guarantors and subjects, and the attacker's subjects. The declare-war dialog lists who will join
and what it costs. An attacker can also call its allies to arms: AI allies join when their opinion
of the caller is above 40, their opinion of the target is below 20, their stability is above 35
and they are not already at war; the player gets an offer.

Peace terms (on top of provinces, which Milestone 2 already had): reparations (cost 20 war score),
making the loser a subject (70, losers with at most 30 provinces) and, for a subject fighting its
overlord, independence (30). Provinces the taker has claims on are 40% cheaper. Lost provinces
become claims for 30 years. Co-belligerents can sign a **separate peace** with the enemy leader
and leave the war.

## Sanctions and the world council

Besides a full **embargo**, a country can impose **arms sanctions** (munitions, machinery,
electronics) or **energy sanctions** (coal, oil, natural gas, fuel, uranium) from the other
country's Nation tab: only those goods stop flowing between the two (opinion −7.5).

From 1920 the **League of Nations** (the **United Nations** from 1945) meets (`src/core/council.js`,
numbers in `balance.json` → `council`). The five countries with the highest prestige when it is
founded, and again when it becomes the UN, are its permanent members and can veto. Any country can
propose (the player pays 20 influence; each country once every 6 months):

| Resolution | Effect when passed |
| --- | --- |
| Arms, energy or full sanctions on a country | Every country that did not vote against stops trading those goods (full: all goods) with it for 5 years; each yes vote costs 10 opinion with the target |
| Ceasefire in a war | No fighting for a year: battles stop, armies cannot enter enemy land and sieges halt. The war goes on on paper (trade stays closed, peace can be signed) and fighting may resume when it ends |
| Demilitarised zone between two countries | Neither may enter the provinces on either side of their shared land border for 10 years; their armies there withdraw |

Voting closes 30 days after a proposal. A resolution passes with more yes than no votes and no
permanent member voting no. The Diplomacy tab shows open votes with the expected result, lets you
vote, and lists what is in force. Countries vote by their interests: sanctions on a country they
dislike, that started an unprovoked war, has a bad reputation or fights them are favoured, and
sanctions on a big trading partner or an ally are not; outsiders want ceasefires unless they side
with the winner, the side that is winning votes against; the weaker of two countries wants a DMZ.
Only clear opposition votes no; doubts abstain.

The AI proposes at most one resolution every 3 months: a ceasefire in a war older than 18 months,
sanctions on the attacker in an unprovoked war of the last year (full if its reputation is below
−50), arms sanctions on a pariah (reputation below −60), and a DMZ between two countries under a
ceasefire. A resolution that failed is not proposed again by the AI for 2 years.

## AI diplomacy

Every 3 months per country (spread across days), each AI:
1. picks a rival among its neighbours and great powers by how much it dislikes them and how much
   of its land they hold (with hysteresis so rivals don't flip);
2. reviews its treaties (after the first year, ends ones with its rival or with countries it
   now dislikes below −30);
3. every other round seeks one treaty: an alliance or defensive pact when its rival is
   dangerous (one, or two under a strong threat; the partner must border it or its rival), a NAP
   with a stronger neighbour, a trade deal with a friendly neighbour or great power, or a
   guarantee of its rival's neighbours if it is a great power;
4. embargoes countries it strongly dislikes (opinion below −60), but never an economy over 4× its
   size;
5. occasionally applies to a bloc when its rival clearly outmatches it, and spends influence on
   the countries whose acceptance it is closest to winning.

War decisions (in `ai.js`) now need a motive first (low opinion, rivalry, claims or independence),
weighed against breaking treaties and unjustified-war costs, then odds that count both sides'
likely joiners. Each decision is logged with its reasons in the AI tab.
