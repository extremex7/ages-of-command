# Performance

All numbers below were measured on 2026-10-18 after Milestone 4 (diplomacy and government), in the build container (4 vCPU cloud VM, headless
Chromium with software rasterisation, 1366×768, device scale 1). They are **not** measurements on
real minimum-spec hardware; the 4× CPU-throttled run is an emulation of a slower machine.

## Reproduce

```bash
npm run bench                                   # simulation only (Node)
npm start & node tests/browser/bench.mjs        # browser, per profile
CPU_THROTTLE=4 node tests/browser/bench.mjs     # emulated 4x slower CPU
```

## Simulation (Node, `npm run bench`, seed `bench-1`, 2,358 provinces, 196 countries)

| Metric | M4, AI aggression 1 (10 years) | M4, AI aggression 4 (5 years) | M3, aggression 1 | M3, aggression 4 |
| --- | --- | --- | --- | --- |
| Time per game day (avg) | 0.93 ms | 1.51 ms | 0.53 ms | 0.86 ms |
| Daily tick p50 / p99 | 0.42 / 2.73 ms | 0.87 / 4.19 ms | 0.21 / 1.74 ms | 0.44 / 2.27 ms |
| Monthly tick p50 / max | 8.6 / 37 ms | 10.4 / 38 ms | 4.1 / 48 ms | 6.7 / 32 ms |
| Save / load | 20 ms (1,114 KB JSON) / 49 ms | 25 ms (1,152 KB) / 49 ms | 14 ms (841 KB) / 30 ms | 19 ms (873 KB) |
| JS heap during run | 35–57 MB | 40–66 MB | 27–61 MB | ~61 MB |

A 10-year campaign simulates in ~3.4 s. Milestone 4 adds per-country work that did not exist
before: monthly faction approval for 7 factions, legitimacy and elections, a monthly event check
per country, and an AI diplomacy round per country every 3 months (opinion is computed on demand
from treaties, blocs, borders and modifiers). To keep it cheap the event checks and AI diplomacy
are spread across days, event conditions are compiled once, AI war decisions test a cheap motive
before computing odds and run every 4th diplomacy round, and the AI reviews only two policy
groups a year. The first M4 build had a 33 ms monthly p50; these changes brought it to ~9 ms.
The daily tick stays well under 1 ms. Saves grew by ~270 KB (governments, treaties, opinion
modifiers); browser slots are gzip-compressed (~260–320 KB per slot).

## Browser (`tests/browser/bench.mjs`)

| Profile | CPU | Boot | FPS while panning/zooming | p95 frame | Base-layer render | Max-speed sim (5 s) | JS heap | Frames while paused & idle |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Low | 1× | 271 ms | 60.3 | 18.3 ms | 7.1 ms | 802 days | 20 MB | 0 |
| Balanced | 1× | 249 ms | 60.3 | 19.0 ms | 14.6 ms | 608 days | 21 MB | 0 |
| High | 1× | 263 ms | 60.6 | 19.2 ms | 17.2 ms | 730 days | 41 MB | 0 |
| Low | 4× slower | 966 ms | 38.0 | 60.6 ms | 22.3 ms | 370 days | 24 MB | 0 |
| Balanced | 4× slower | 837 ms | 34.8 | 59.6 ms | 67.5 ms | 286 days | 15 MB | 0 |
| High | 4× slower | 902 ms | 31.7 | 63.3 ms | 78.9 ms | 182 days | 29 MB | 0 |

After Milestone 3 the low profile at 4× throttle measured 43.5 FPS and 364 simulated days in 5 s.
Run-to-run variance in this container is large (repeat runs of the same build differ by ±20% in
simulated days), so M4 is level with M3 on fast-forward speed and slightly lower on FPS, still
above the 30 FPS target. The benchmark now lets the AI answer the player's events, since an event
dialog pauses the clock.

**Regression found and fixed.** The first M4 browser run fast-forwarded only 84 days in 5 s at
4× throttle. A CPU profile showed 3.6 s of 5 s in `drawImage`: every new treaty bumped the
relations version and the client repainted the whole map base, which with AI diplomacy happened
almost every day. Only the diplomacy and military map modes colour by relations, so other modes
now ignore relation changes (`src/ui/client.js`).

## Size

| Item | Size |
| --- | --- |
| Whole game (code + data, uncompressed) | ~3.5 MB |
| `data/map/world.json` | 3.0 MB (0.9 MB gzip; the dev server gzips) |
| Modern World scenario (incl. economy and diplomacy) | 275 KB (49 KB gzip) |

## Provisional targets and status

| Target | Status |
| --- | --- |
| ≥30 FPS map interaction on minimum spec | Met in emulation (38 FPS low profile at 4× throttle); needs real-hardware validation |
| Idle CPU ≈ 0 when paused | Met (no frames scheduled) |
| Install < 500 MB | Met (~3.5 MB) |
| Modest RAM | Met (~15–66 MB JS heap) |
| Fast-forward without freezing UI | Met (ticks run within a per-frame time budget) |
