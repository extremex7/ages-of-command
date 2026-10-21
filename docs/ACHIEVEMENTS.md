# Achievements and the game summary

Code: `src/core/record.js` (the record and the achievement tests), `src/ui/summary.js`
(the summary dialog and the achievements list), `src/core/victory.js` and `src/ui/victory_ui.js`
(victory conditions, the score and the victory screen).

## The record

When you take over a country, the game notes where it stands: world rank and prestige, GDP and
its share of the world economy, population, provinces, technologies, era, government, whether it
is a subject, and its warheads and off-world settlements. Each January it adds a sample, and it
counts battles (land and naval) and wars won and lost, white peaces, coups you staged and world
council resolutions you proposed that passed. It also keeps your best rank, how many months in a
row you have been first, and how many months since your last war. The record is part of the save.
If you switch countries (joining the rebels in a civil war), it starts again for the new country
and keeps the achievements already earned. In observer mode nothing is recorded. In a hotseat
game (several players at one computer) every player has their own record, kept with them in the
save.

## The summary

Menu → **Summary** at any time, and on its own when the game ends (your country is annexed):

- a headline, for example "Poland rose from #48 to #21 in 12 years, earning a silver star";
- the world rank over the years, with the gold, silver and bronze bands behind it;
- the start against now: rank, prestige, GDP (and by how much it grew), share of the world
  economy, population, provinces, technologies, era and government;
- battles and wars won and lost, coups, council resolutions and the best rank reached;
- the achievements earned in this game.

## Victory conditions

Chosen at New Game; any number of them may be on, and with none the game is a sandbox. The first
country to meet one wins:

- **Conquest**: own 25%, 50%, 75% or all of the world's provinces (counting your subjects' land).
- **Economy**: be the largest economy with 25% to 50% of world GDP for 5, 10 or 20 years in a row.
- **Technology**: be the first to know every technology of a chosen era (the last era by default).
- **Score**: have the best score (prestige) on 1 January of a chosen year (100 years after the start by default).

The capitulation threshold (off, 40%, 60% or 80%) is set in the same place ([MILITARY.md](MILITARY.md)).

They are checked monthly. Your score is in the top bar, with your progress towards each
condition in its tooltip; click it for every condition, your progress and who is closest. When a
country wins, the game pauses on the victory screen (or the news of another country's victory)
with the summary below. **Continue playing** goes on with no further victories; the summary
headline then starts with the victory.

## Achievements

Checked monthly for the country you lead. Each is announced once per game and kept on the device
(main menu → **Achievements**, with the country and date it was first earned). A game in which
cheats were used earns none, and neither do hotseat games: the device's achievement list belongs
to one person, and the players of a hotseat game share the device. The summary still works for
each of them: Menu → Summary in a player's turn shows theirs, and at the end of the game every
player's headline is listed with a button for their summary.

While the bot plays your country (docs/BOT.md) no achievements are earned: the months it plays
are recorded in the summary, but achievements are for what you do yourself.

| Achievement | How |
| --- | --- |
| On the world stage | Reach the top 25 of the world leaderboard (a silver star). |
| Great power | Reach the top 10 (a gold star). |
| First among nations | Rank first in the world. |
| Hegemon | Stay first in the world for 10 years in a row. |
| Rising star | Climb at least 5 places and 30% of your rank in about five years. |
| Underdog | Start ranked 50th or lower and reach the top 25. |
| From nowhere to gold | Start outside the top 25 and earn a gold star. |
| First victory | Win a battle. |
| Veteran army | Win 50 battles. |
| Victor | Win a war: make peace on your terms. |
| Conqueror | Win three wars. |
| Long peace | Go 25 years without a war. |
| Empire builder | Hold twice as many provinces as at the start. |
| Economic miracle | Double your share of the world economy. |
| Frontier of knowledge | Know more technologies than any other country. |
| A new age | Enter a new era of technology. |
| Content people | Reach stability 90. |
| New constitution | Change your form of government. |
| Free at last | Start as a subject and become independent. |
| Kingmaker | Topple a foreign government in a coup. |
| Voice of the world | Have a resolution you proposed passed by the world council. |
| The bomb | Build your first nuclear warhead. |
| Off-world | Found your first settlement beyond Earth. |
| Still standing | Lead your country for 50 years. |
