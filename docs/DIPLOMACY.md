# Diplomacy

Tuning numbers: the `diplomacy` section of `data/rules/balance.json`. Code:
`src/core/diplomacy.js` (treaties, opinion, trust, proposals), `src/core/relations.js` (the fast
relation matrix the movement and war code read), `src/core/war.js` (joining wars, peace terms),
`src/core/ai_diplomacy.js` (AI), `src/core/deals.js` and `src/core/ai_deals.js` (loans, ultimatums,
personal unions, province and money deals, rebel support; numbers in `balance.json` → `deals`).

## Opinion, trust, reputation, influence

**Opinion** (−100…100) is computed on demand, never stored, from:

| Term | Value |
| --- | --- |
| Government families | −20…+15 (see GOVERNMENT.md) |
| Each treaty | alliance +25, defensive pact +20, guarantee +15, personal union +15, NAP +10, trade +10, access +5; a subject −10 toward its overlord |
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
| Personal union | senior → junior | One crown for both: the junior keeps its name, economy and armies but has no foreign policy of its own and joins the senior's wars; both defend each other. See Deals below |

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
making the loser a subject (70, losers with at most 30 provinces), a personal union with a much
weaker loser (50, see Deals; the AI asks for one when both sides are monarchies) and, for a subject fighting its
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

## Deals

Peacetime deals, offered from the **Deals** row of another country's Nation tab. Each dialog shows
the other side's answer before you send it, worked out like a treaty proposal: a score from a
list of reasons, accepted above 0. AI countries answer at once; offers to the player wait in the
Diplomacy tab ("Deals offered to you") until a deadline of 30 days. Everything is logged and the
player is told of anything that concerns them. Numbers: `balance.json` → `deals`.

**Casus belli.** A refused ultimatum (2 years), a defaulted loan (5 years), a junior partner that
breaks away (2 years) and detected money for rebels (3 years) give the wronged country a casus
belli: a war on that country is justified (no unprovoked-war reputation cost), the declare-war
dialog says so, and the AI counts it as a motive for war (+0.4). The Diplomacy tab lists yours
and those held against you.

### Loans

The amount is 1, 3, 6 or 12 months of the borrower's revenue, at 3%, 6% or 10% a year, over 2,
5 or 10 years, repaid in equal monthly instalments (an annuity) straight from the borrower's
treasury to the lender's. A borrower may owe at most 12 months of revenue and spend at most 30%
of its revenue on repayments. The lender must have the money and keep a month of revenue.

| Who decides | Reasons |
| --- | --- |
| Lender (when asked) | −10 base; 0.4 × its opinion of the borrower; 0.5 × (trust − 50); (rate − wanted rate) × 400, the wanted rate being 4% plus 2 points per month of the borrower's debt (up to 10) and a premium for heavy repayments; −10 if the borrower is at war; +5 for a much smaller economy; rivals never lend |
| Borrower (when offered) | −5 base; +20 to +50 when in debt, +10 with low reserves, −15 or less when it does not need money; when in debt, (5% debt interest − rate) × 400, otherwise −300 × rate; 0.2 × opinion; +10 at war |

The borrower pays while its debt after paying stays within 6 months of its revenue. Three missed
instalments in a row are a **default**: reputation −15 (−25 when the player repudiates on
purpose with **Default**), the lender's opinion −50 and trust −40 (fading slowly) and a casus
belli. A borrower can repay early (lender +5 opinion); a repaid loan also earns +5. A loan from a
country that ceases to exist is void; a loan to one is lost.

### Ultimatums

A demand without war: up to 3 provinces (the target's controlled border provinces or your claims,
never the capital), tribute of 1, 3 or 6 months of its revenue, or that it becomes your subject (at
most 30 provinces). It costs 15 influence and 3 reputation (no reputation when the target is your
rival, holds your claims or you already have a casus belli). The same country can be sent one
ultimatum a year. The target weighs:

| Reason | Value |
| --- | --- |
| Yielding to threats | −25 |
| Your strength against theirs, counting everyone who would join each side (as the AI's war odds) | 30 × log₂(ratio), ±60 |
| Friends who would fight for them | −5 each (up to 4) |
| Their opinion of you | 0.25 × opinion |
| Provinces | −10 each and −300 × their share of its economy; +5 per province you claim |
| Tribute | −8 per month of revenue; −15 if it would have to borrow |
| Subjugation | −60 |
| At war elsewhere / a shaky government (stability < 30) | +15 / +10 |
| Your nuclear weapons (they have none) / their deterrent | +15 / −30 |
| Nationalist or military government | −10 |
| Your reputation below −30 | −10 |

Yielding hands over the provinces (they become the target's claims), the money or its foreign
policy (it leaves its treaties and blocs), and costs it 5 stability and −30 opinion of you.
Refusing, or letting the deadline pass, gives you a casus belli for 2 years and costs −15 opinion.

### Personal unions

A junior partner must have at most 35% of the senior's strength (the mean of its army and economy
ratios, each capped at 3×) and at most 30 provinces, and neither may already answer to someone or
have subjects or partners. Made three ways: a diplomatic offer (20 influence; the junior must
accept), a peace term (cost 50 war score, against 70 for subjugation) or an event (the
`union` effect; the world event "A crown without a king" offers a monarch the crown of a much
weaker neighbouring monarchy that likes it). The junior weighs an offer: −45 for giving up its
foreign policy, 0.6 × opinion, 0.3 × (trust − 50), +15 when both are monarchies (−20 for a
non-monarchy democracy), +5 for similar governments, +20 for protection from a stronger rival
(+30 when it is the senior's rival too), +10 for help in a war, +5 for neighbours, −10 for a
senior with reputation below −30; never from its rival.

In a union the two are allies (each joins a war on the other, troops pass), the junior cannot sign
treaties with anyone else, declare war or make a separate peace, and it follows the senior into
wars it declares or joins. After 10 years, with the junior's opinion of the senior at least 50 and
neither at war, the senior can **integrate** it for 40 influence: its provinces, armies, fleets,
wings and treasury pass to the senior and it ends. The senior can release the junior (End in the
treaty list); the junior can **break away** when its opinion of the senior falls below 0 or the
senior's stability below 25, which costs −30 opinion and gives the senior a casus belli.

### Provinces and money

Any controlled, non-capital province that borders the other country (or is its claim) can be sold,
bought or given in peacetime. Its value is 10 years of the tax it brings (province GDP × the
owner's tax rate × 10); prices run from 50% to 200% of it.

| Who decides | Reasons |
| --- | --- |
| Seller | −20 reluctance; 60 × (price ÷ value − 1); −200 × the province's share of its economy; −20 under a nationalist government (−5 in a democracy); +10 when the buyer claims it; up to +30 when in debt; 0.2 × opinion; never to its rival |
| Buyer | −5; 60 × (1 − price ÷ value) (+20 for a gift); −15 or more when it would keep less than 2 months of revenue; +10 if it borders the buyer, −15 if not; +20 for its former land; 0.1 × opinion |

A gift of land earns +25 opinion; a sale +5. **Send money** gives part of your monthly revenue
(10% to 100%) for +15 opinion per month of the recipient's revenue, at most +40, fading 0.5 a month.

### Support for rebels

From another country's Nation tab you can fund its unrest, or in a civil war its rebels, at
three levels costing 3%, 6% or 12% of the target's monthly revenue a month. Without a civil war
the target loses 0.5, 1 or 2 stability a month and its monthly civil-war chance is multiplied
by 2, 3 or 4. In a civil war the money goes to the rebel treasury with manpower, the rebels'
largest army gains a unit with a 20%, 40% or 70% chance a month, and they think better of you (if
they win independence: +30). Each month the support is found out with a 3%, 5% or 8% chance (+5
points under counter-intelligence): the target's opinion −40 and trust −30 (fading slowly) and a
casus belli against you for 3 years. Funding stops when you cannot pay, and is not possible against
allies or rebels you are at war with.

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

Deals (`ai_deals.js`, in the same round): a country more than a month of revenue in debt (or at
war and low on money) asks the friendliest great power or neighbour that would agree for a loan
at the lowest rate it accepts (half the time); a senior partner integrates a junior that is ready
(half the time); a monarchy offers a personal union to a much weaker neighbouring monarchy that
would accept (10% of rounds); it funds the rebels of its rival in a civil war, or the unrest of a
rival under stability 25 if it is aggressive, while it keeps 2 months of revenue; more than 6
months of revenue in debt it offers its least valuable border province to a neighbour that would
buy it at its value, and with 6 months in hand it buys back lost provinces from holders it does
not hate; and rarely (6% of rounds × aggression) it sends an ultimatum to a neighbour it has a
quarrel with (rival, claims or opinion below −10) and outmatches 3 to 1: its claims, the largest
tribute the target would pay (or the smallest), or subjugation of a tiny country that would
accept. Junior partners break away when they can (half the time). Offers to the player are capped
at three waiting at once.

War decisions (in `ai.js`) now need a motive first (low opinion, rivalry, claims, a casus belli or independence),
weighed against breaking treaties and unjustified-war costs, then odds that count both sides'
likely joiners. Each decision is logged with its reasons in the AI tab.
