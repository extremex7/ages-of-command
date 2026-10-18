# Performance

All numbers below were measured on 2026-10-18 in the build container (4 vCPU cloud VM, headless
Chromium with software rasterisation, 1366×768, device scale 1). They are **not** measurements on
real minimum-spec hardware; the 4× CPU-throttled run is an emulation of a slower machine.

## Reproduce

```bash
npm run bench                                   # simulation only (Node)
npm start & node tests/browser/bench.mjs        # browser, per profile
CPU_THROTTLE=4 node tests/browser/bench.mjs     # emulated 4x slower CPU
```

## Simulation (Node, `npm run bench`, seed `bench-1`, 2,358 provinces, 196 countries)

| Metric | AI aggression 1 (10 years) | AI aggression 4 (5 years) |
| --- | --- | --- |
| Time per game day (avg) | 0.41 ms | 0.76 ms |
| Daily tick p50 / p99 | 0.25 / 1.57 ms | 0.46 / 2.75 ms |
| Monthly tick p50 / max | 1.35 / 28 ms (first month) | 2.8 / 10 ms |
| Armies at end | 422 | 580 |
| Save / load | 14 ms (337 KB) / 5 ms | 4 ms (399 KB) / 6 ms |
| Map parse + decode, new game | 40 + 33 ms, 13 ms | |
| JS heap during run | 30–48 MB | ~52 MB |

A 10-year campaign simulates in ~1.5 s.

## Browser (`tests/browser/bench.mjs`)

| Profile | CPU | Boot | FPS while panning/zooming | p95 frame | Base-layer render | Max-speed sim (5 s) | JS heap | Frames while paused & idle |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Low | 1× | 494 ms | 60.6 | 19.7 ms | 4.3 ms | 4,625 days | 15 MB | 0 |
| Balanced | 1× | 434 ms | 60.6 | 18.0 ms | 12.3 ms | 3,066 days | 25 MB | 0 |
| High | 1× | 400 ms | 60.4 | 18.1 ms | 12.4 ms | 3,694 days | 21 MB | 0 |
| Low | 4× slower | 944 ms | 49.2 | 37.7 ms | 18.9 ms | 502 days | 22 MB | 0 |
| Balanced | 4× slower | 881 ms | 35.6 | 54.9 ms | 40.7 ms | 239 days | 14 MB | 0 |
| High | 4× slower | 963 ms | 36.0 | 53.2 ms | 47.0 ms | 215 days | 15 MB | 0 |

## Size

| Item | Size |
| --- | --- |
| Whole game (code + data, uncompressed) | ~3.5 MB |
| `data/map/world.json` | 3.0 MB (0.9 MB gzip; the dev server gzips) |
| Modern World scenario | 126 KB |

## Provisional targets and status

| Target | Status |
| --- | --- |
| ≥30 FPS map interaction on minimum spec | Met in emulation (49 FPS low profile at 4× throttle); needs real-hardware validation |
| Idle CPU ≈ 0 when paused | Met (no frames scheduled) |
| Install < 500 MB | Met (~3.5 MB) |
| Modest RAM | Met (~15–50 MB JS heap) |
| Fast-forward without freezing UI | Met (ticks run within a per-frame time budget) |
