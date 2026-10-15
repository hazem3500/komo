# Performance audit — 2026-09-16

Baseline: commit `95fa3c83`. All functionality and animation paths remain available.

## Size

Production ESM consumer build, esbuild splitting enabled; decimal bytes. Initial transfer includes static imports; optional chunks load on demand.

| Metric | Before | After |
| --- | ---: | ---: |
| Initial JavaScript, gzip | 195,045 | 160,203 |
| Initial JavaScript, Brotli | 171,087 | 138,944 |
| All JavaScript, gzip | 208,345 | 178,817 |
| npm archive | 347,950 | 341,808 |
| Installed dependencies, KiB | 41,552 | 28,852 |

The install comparison uses the same package artifact with and without the three former runtime dependencies. This isolates their disk cost: 30.6% less. The archive itself is only 1.8% smaller; unpacked package size is approximately unchanged. React, React DOM, and the official icon package remain dependencies. Bundlers can share React with the host application.

The accent picker loads on demand. CSS and published JavaScript are minified. Motion and picker code ship as bundled chunks, avoiding installation of their full development trees. Bundled dependency licenses ship in `dist/THIRD_PARTY_NOTICES.txt`. Icons still come from the official dependency.

## Runtime

Synthetic desktop browser workload: 1280 × 900, 5,000 DOM rows, 250 open threads with long bodies, 100 text mutations per frame, 180 frames after a two-second warmup. No server writes. One run per configuration; frame intervals include host work and browser scheduling, not just komo CPU time.

| Metric | Before | After |
| --- | ---: | ---: |
| Mean frame interval | 120.45 ms | 12.37 ms |
| Worst frame interval | 932.6 ms | 17.7 ms |
| Selector queries during measurement | 44,500 | 0 |
| Occlusion hit tests | 22,250 | 2,581 |

With no comments, komo made no geometry reads, selector queries, or hit tests during the mutation workload. Mean frame interval was 8.28 ms, compared with 8.25 ms without komo.

Changes remove repeated full-thread serialization, cache connected anchor elements, skip offscreen hit tests, coalesce pointer work, avoid duplicate refresh renders, and pause mutation observation in background tabs. Static icons no longer create temporary React roots.

These results are not Core Web Vitals or a guarantee of negligible overhead on every device. Real iOS Safari, Firefox, low-end Android, memory profiling, and long-session testing remain release validation work. Large visible thread counts still require geometry work.

## Reproduce

```sh
pnpm --filter @hazem3500/komo build
pnpm --filter @hazem3500/komo size
pnpm --filter @hazem3500/komo bench
```

Open the benchmark URL printed by the final command. Use `?mode=none` for the host-only control and `?mode=after&comments=0` for an empty project. To compare an older production ESM bundle, set `KOMO_BENCH_BASELINE` to its directory containing `index.js` and use `?mode=before`. Keep viewport, browser, hardware, and foreground state identical.

The size command fails above 170,000 gzip bytes initially or 195,000 across all feature chunks. These budgets make future growth explicit. Benchmark files and build tooling do not ship in the npm archive.
