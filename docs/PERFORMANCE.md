# Performance

All numbers below were measured on 2026-10-18 after Milestone 3 (economy), in the build container (4 vCPU cloud VM, headless
Chromium with software rasterisation, 1366×768, device scale 1). They are **not** measurements on
real minimum-spec hardware; the 4× CPU-throttled run is an emulation of a slower machine.

## Reproduce

```bash
npm run bench                                   # simulation only (Node)
npm start & node tests/browser/bench.mjs        # browser, per profile
CPU_THROTTLE=4 node tests/browser/bench.mjs     # emulated 4x slower CPU
```

## Simulation (Node, `npm run bench`, seed `bench-1`, 2,358 provinces, 196 countries)

| Metric | AI aggression 1 (10 years) | AI aggression 4 (5 years) | Before M3 (aggr. 1) |
| --- | --- | --- | --- |
| Time per game day (avg) | 0.53 ms | 0.86 ms | 0.41 ms |
| Daily tick p50 / p99 | 0.21 / 1.74 ms | 0.44 / 2.27 ms | 0.25 / 1.57 ms |
| Monthly tick p50 / max | 4.1 / 48 ms | 6.7 / 32 ms | 1.35 / 28 ms |
| Save / load | 14 ms (841 KB JSON) / 30 ms | 19 ms (873 KB) / 42 ms | 337 KB |
| Map parse + decode, new game | 40 + 37 ms, 41 ms (incl. economy calibration) | | 40 + 33 ms, 13 ms |
| JS heap during run | 27–61 MB | ~61 MB | 30–48 MB |

A 10-year campaign simulates in ~2 s. The monthly economy (production, market for 14 goods,
196 countries, effects) costs ~4 ms; the first version cost ~24 ms until the market's pairwise
loops were replaced by a factorised formula (see ECONOMY.md) and per-country scans by one pass.
Browser save slots are gzip-compressed (~280 KB per slot; exported files stay plain JSON).

## Browser (`tests/browser/bench.mjs`)

| Profile | CPU | Boot | FPS while panning/zooming | p95 frame | Base-layer render | Max-speed sim (5 s) | JS heap | Frames while paused & idle |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Low | 1× | 517 ms | 60.6 | 19.1 ms | 6.3 ms | 1,678 days | 53 MB | 0 |
| Balanced | 1× | 464 ms | 59.8 | 18.0 ms | 12.4 ms | 2,099 days | 47 MB | 0 |
| High | 1× | 398 ms | 60.5 | 18.6 ms | 15.2 ms | 1,439 days | 20 MB | 0 |
| Low | 4× slower | 918 ms | 43.5 | 45.9 ms | 25.4 ms | 364 days | 17 MB | 0 |
| Balanced | 4× slower | 1,087 ms | 34.8 | 65.0 ms | 63.4 ms | 243 days | 28 MB | 0 |
| High | 4× slower | 887 ms | 33.6 | 57.6 ms | 43.8 ms | 273 days | 32 MB | 0 |

Before Milestone 3 the low profile reached 49 FPS and 502 simulated days in 5 s at 4× throttle;
the economy costs some fast-forward speed (still ~70 days per second on the emulated slow CPU)
and stays above the 30 FPS target. Heap readings vary with garbage-collection timing.

## Size

| Item | Size |
| --- | --- |
| Whole game (code + data, uncompressed) | ~3.5 MB |
| `data/map/world.json` | 3.0 MB (0.9 MB gzip; the dev server gzips) |
| Modern World scenario (incl. economy) | 276 KB |

## Provisional targets and status

| Target | Status |
| --- | --- |
| ≥30 FPS map interaction on minimum spec | Met in emulation (43 FPS low profile at 4× throttle); needs real-hardware validation |
| Idle CPU ≈ 0 when paused | Met (no frames scheduled) |
| Install < 500 MB | Met (~3.5 MB) |
| Modest RAM | Met (~17–61 MB JS heap) |
| Fast-forward without freezing UI | Met (ticks run within a per-frame time budget) |
