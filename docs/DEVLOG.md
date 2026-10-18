# Development log

## 2026-10-18 — Session 1: environment, stack, Milestone 1 + prototype

**Environment.** Linux container with Node 22, Python 3.13, headless Chromium + Playwright, no GPU.
GitHub and naturalearthdata.com are blocked by the network policy; the npm registry and PyPI work.
Godot could not be downloaded, so it was ruled out (see ARCHITECTURE.md).

**Map data.** Natural Earth (public domain) obtained through npm packages:
`@geo-insight/data` (NE 10m admin-1, pre-split per country) and `@cublya/world-atlas`
(NE 50m admin-0). Five territories missing from the admin-1 package (South Sudan, Western
Sahara, Palestine, Åland, Siachen) are filled from admin-0.

**Pipeline decisions.**
- Raw admin-1 has wildly uneven granularity (Slovenia 193 units, UK 232, Russia 86), so units
  are merged per country toward a √area target and huge regions split → 2,358 provinces.
- `shapely.coverage_simplify` keeps shared borders identical, which lets the pipeline export
  shared border polylines; the renderer strokes country borders without runtime topology.
- 97 provinces had no land neighbour; straits (≤ 50 km) plus sea lanes connecting every
  landmass make the whole graph connected (verified by a test).
- Capital provinces are renamed after their capital city (e.g. the merged Paris region was
  originally named "Loiret").

**Bugs fixed during the session.**
- Merge loop never terminated for countries made only of islands (fixed with a frozen set).
- Seams between adjacent fills from anti-aliasing (hairline stroke in the fill colour).
- `.kv` panels rendered as run-on text (text nodes are not grid cells; wrapped in spans).
- AI pulled armies off nearly finished sieges (AI now finishes sieges unless invaded).
- Reloaded games diverged from the original after a few days: country caches and ledgers were
  recomputed on load, and the AI reads them. They are now saved, and a test checks that a
  reloaded game continues identically.
- AI declared ~12 wars per year in the modern world (incl. France vs Dominica over a strait);
  war chance and government aggression were reduced.

**Results.** 26 automated tests pass; Playwright end-to-end run (new game → play → recruit →
move → fast-forward → save → reload) passes with no console errors. Benchmarks in PERFORMANCE.md.

**Next.** Milestone 3 economy (resources, production, construction, trade), then diplomacy and
government (M4), technology and historical scenarios (M5). See FEATURES.md.
