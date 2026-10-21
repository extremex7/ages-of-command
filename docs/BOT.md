# The bot: let the computer play your country while you are away

The bot is a separate window (not part of the game screen) that takes one of your saves, plays
your country by itself for as long as you like, and writes a new save with your country back in
your hands. When you come back, load that save in the game and carry on.

It is a helper next to the game, not a game mode: the game itself is unchanged and you keep full
control whenever you play.

## How to run it

**Windows, installed:** Start menu → **Ages of Command** → **Ages of Command Bot**.
**Windows, portable zip:** double-click **Ages of Command Bot.cmd** next to `AgesOfCommand.exe`.
**Any desktop package, from a terminal:** `AgesOfCommand.exe --bot` (Windows),
`./AgesOfCommand --bot` (Linux), `./start.command --bot` (macOS). `-data DIR` works as usual.

If the game is already open, the bot window opens next to it and uses the same saves.

In the bot window:

1. **Pick a save.** The newest is selected; any save, quicksave or autosave can be used.
2. **How long to play:** until you stop it, or 1, 5, 10, 25, 50 or 100 game years.
3. **Computer use:** *Full speed* uses one processor core (the simulation is single-threaded,
   so the rest of the computer stays free); *Half* and *Light* pause between bursts of work so
   the fans stay quiet on a laptop. It can be changed while the bot plays.
4. **Start the bot.** The window shows the date, game days per second, and your country at the
   start against now: provinces, population, GDP and its world share, treasury (or debt), monthly
   balance, world rank, score, technologies, era, stability and wars; the tally of wars and
   battles won and lost; nations formed, revolts and wars declared; and a list of what happened
   to your country (wars, peace treaties, events and the bot's choices, formed nations, golden
   ages, revolts, annexations).
5. **Stop and save** whenever you are back (or let it finish the years you asked for).
6. Open the game, **Load Game**, and load **"Bot – \<country> \<date>"**. You are playing again,
   with your own settings (for example "auto-manage economy") as you left them.

It plays about one game year a second on a recent PC at full speed (see "Speed" below).

### Your saves are safe

- The save you pick is **never changed**. The bot plays a copy.
- It writes its own slot, **"Bot – \<country> \<date>"** (for example "Bot – France 1 Jan 1450"),
  every game year and when it stops. Each run keeps one slot: the newer save replaces the run's
  previous one, so a long run does not fill the list. It never takes the name of an existing
  save (it adds " (2)" instead).
- Every bot save has your country back under your control: loading it is just loading a game.
- If the bot window is closed without **Stop and save**, the last yearly save is kept; what was
  played since then is lost (the window asks before closing while the bot runs, where the web
  engine allows it).

### Playing while the bot runs

The game and the bot window share the saves folder safely: **Load Game** reads the list of saves
from disk each time it opens, and saving in the game keeps the bot's slots in the list (it reads
the list again before writing it). So you can open the game while the bot plays, for example to
look at another save. Do not play *the same* game in both windows at once and expect them to
merge: the bot plays its own copy, and its result is a separate save.

## What the bot does

The bot hands your country to the game's own AI, the same one that runs every computer opponent,
and lets it make every decision:

- the budget (taxes, civil spending), recruitment and disbanding, armies, fleets, air wings and
  supply depots, war and peace (declaring wars, peace terms, separate peace);
- research (choosing projects), construction (factories, mines, power, infrastructure), colonies;
- diplomacy: treaties, blocs, deals (loans, unions, land sales, ultimatums, rebel funding),
  calls to arms, the world council votes, spies;
- government policies and reforms, advisors, generals, national objectives, forming a nation,
  religion and tolerance, sending armies against rebels;
- domestic events (the AI's choice, which favours the historical option in historical games).

Anything that was **waiting for you** when the bot started (an event, a treaty proposal, peace
terms, a call to arms, a loan offer, an ultimatum, a union offer, a land sale, the civil-war
choice) is answered the way the AI would answer it, and listed in the window under "Decisions
waiting for you that the bot answered". While the bot plays, nothing waits for you: the game
never stops to ask.

"At its strongest" means: the bot uses the **hard difficulty's war appetite and an AI
aggression of 1.5** for your country only (the other countries keep the settings of your game),
it may **start wars** (an automated country otherwise never does), and it **forms a nation as
soon as your country qualifies** (the AI otherwise waits for a random roll). These choices were
measured, see below.

What it does not do:

- **No achievements** are earned while the bot plays (they are for what you do). The game
  summary still records the years.
- Your **battle plans** (fronts and attack arrows) are dropped when the bot takes over; the AI
  gives its own orders.
- In a **civil war** in your country, you keep leading the government.
- **Hotseat games and observer games** cannot be played by the bot (it plays one human country).
- The bot is **not available in the Android app**. From source, `npm start` and
  `http://localhost:8080/bot.html` run the same window on the saves of that browser.

## How well it plays

Measured with `tools/bot_compare.mjs`: the same country, scenario and seed played once by the
ordinary AI (nobody is the player) and once by the bot as the player; the numbers are the bot's
result divided by the AI's after the given years (geometric mean over countries and seeds).

**30 years from Rise of Empires 1444** (France, Castile, Muscovy, Ottomans, Bohemia, Poland,
England, Hungary; seeds 1 to 4, so 32 pairs; peace, normal and aggression 2 on seeds 1 and 2,
16 pairs):

| Bot profile | GDP | Provinces | Population | Score | World rank |
| --- | --- | --- | --- | --- | --- |
| **Hard, aggression 1.5, starts wars (the bot)** | **×1.05** | **×1.09** | **×1.05** | **×1.03** | **+1.1 places** |
| Hard, aggression 1, starts wars | ×1.01 | ×1.02 | ×1.01 | ×1.00 | +0.4 |
| Hard, aggression 2, starts wars | ×0.96 | ×0.93 | ×0.97 | ×1.00 | +0.4 |
| Hard, never starts wars | ×0.92 | ×0.87 | ×0.93 | ×0.98 | −1.3 |

(Per half: seeds 1-2 GDP ×1.036, provinces ×1.068, score ×1.044; seeds 3-4 GDP ×1.069,
provinces ×1.109, score ×1.010.)

**15 years from Modern World 2026** (France, Brazil, India, Turkey, Poland, USA, China, Germany;
2 seeds, 16 pairs): the bot ×1.000 GDP, ×1.005 provinces, ×0.996 score, rank unchanged. In 13
of the 16 pairs the bot's result is identical to the default AI's to the last digit: nobody went
to war, and the automated country made exactly the decisions the AI makes.

In short: the bot plays exactly like the computer opponents in peacetime (the automated country
is run by the same code with the same results, which the 2026 runs show), and somewhat better
than them in an age of frequent wars (about 9% more provinces and 5% more GDP after 30 years
from 1444), because it is allowed a bigger appetite for war than the default AI. A country that
never starts wars clearly does worse, and too much appetite (aggression 2) is worse too. Do not expect miracles: it does not plan a long campaign or a clever economy, it
makes the same decisions a computer opponent would. Results vary a lot between runs (a single
war decides much), so judge it over decades.

Rejected after measuring: spending more on research when the budget allowed it (score ×0.956 over
15 years from 2026: higher taxes cost stability), and an AI aggression of 2 (worse than 1.5:
too many wars at once).

## Speed

Measured with Node.js on the 4-core build container (one core used), the bot playing France:
Rise of Empires 1444 about 350 game days a second (1.05 s a game year), Concert of Europe 1815
about 560 (0.66 s), Modern World 2026 about 365 (1.0 s). In the bot window (headless Chromium,
same container) a run of one 2026 year took 3 to 5 s including loading the map, rules and save;
the yearly save adds a few tenths of a second. A slow laptop may be 3 to 5 times
slower: still roughly a game year every 3 to 5 seconds, over 10 game years an hour even on
*Light*. *Half* and *Light* run 50% and 20% of the time. The simulation's memory is about 60 MB of JavaScript heap (tools/bench.mjs).

The simulation runs in a Web Worker, so the window stays responsive. Whether Windows slows a
minimised WebView2 window's worker has not been tried on a real Windows PC; if it seems slow
while minimised, leave the window open behind others.

## Command line (for developers, or anyone with Node.js 18+)

```bash
node tools/autoplay.mjs --save quicksave --years 20          # the desktop app's saves folder
node tools/autoplay.mjs --save "my game" --data path/to/AgesOfCommand --years 5 --cpu 0.5
node tools/autoplay.mjs --save exported.aoc3.json --years 10 --out result.aoc3.json
```

`--data` is the folder holding the `store` folder (or the `store` folder itself); by default the
desktop app's folder (`%APPDATA%\AgesOfCommand` on Windows, `~/.config/AgesOfCommand` on
Linux). It prints a line a year and a summary at the end, and saves like the bot window
(Ctrl+C stops and saves). `--out` writes a plain save file to import with Load Game → Import.

`node tools/bot_compare.mjs <scenario> <TAG,...> [years] [seeds] [profiles] [first seed]`
repeats the measurement above.

## How it works (for developers)

| File | What it does |
| --- | --- |
| `src/core/automate.js` | `handToAI` turns `c.automate` on with an AI profile and answers everything waiting for the player (`settlePending`); `handBack` restores the player's settings |
| `src/core/ai.js` | `aiTemper`: a country's `aiProfile` (`{ aggression, difficulty, war }`) replaces the game's AI settings for that country only; `war` lets an automated human country start wars |
| `src/bot/autoplay.js` | `Autoplay`: start, `step(days)`, `run()` in slices with pauses (CPU share), `save()` (a save with the player in control, without disturbing the run), `stop()`, the report; `BOT_PROFILE` |
| `src/bot/data.js` | loads the map, rules and the save's scenario (built-in or custom) |
| `src/bot/runner.js`, `worker.js` | the simulation in a Web Worker for the bot window (falls back to the page) |
| `src/bot/page.js`, `bot.html` | the bot window: saves list, options, progress, writing slots |
| `src/ui/storage.js` | `syncSlots` and `readSave` re-read the desktop store, so two windows do not overwrite each other's list |
| `launcher/main.go` | `--bot` opens `bot.html` (onto a running copy if there is one); the program keeps serving while another window still uses it |
| `tools/autoplay.mjs` | the command line bot |

Core changes for automated players (they apply to any country with `c.automate`): an automated
player's country hires generals, runs spies and votes in the world council like the AI; AI
diplomacy evaluates its offers to it like to any AI country; no achievements while automated.

Tests: `tests/bot.test.mjs` (answers what waits, runs without stalling, hands back control,
saves along the way do not change the run, determinism, the CLI never touches the source slot)
and `tests/browser/bot.mjs` (the bot window against the dev server or the launcher: lists saves,
plays a year, stops, saves; the game window opened earlier lists the bot's save and keeps it when
saving; the bot save loads with the player in control; the no-worker fallback).
