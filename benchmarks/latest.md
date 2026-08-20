# Latest benchmark

Recorded on 2026-08-20 with Node 24.19.0, Windows x64, `BALANCED` mode and
10,000 deterministic targets per workload. Run `pnpm benchmark` to reproduce
the full JSON report.

| Workload | cells/s | generated | after 4^3 | after 8^3 | reached 16^3 | materialized bytes/cell |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| simple | 7,879 | 67.01 | 24.90 | 3.52 | 11.05% | 109.73 |
| stairs | 9,525 | 66.55 | 22.45 | 0.73 | 0.00% | 19.63 |
| byte | 9,146 | 67.60 | 24.84 | 0.76 | 4.06% | 37.88 |
| complex | 9,237 | 61.30 | 35.00 | 4.12 | 91.72% | 541.61 |
| mixed | 8,838 | 65.69 | 27.37 | 2.46 | 26.61% | 179.62 |

The packed fixture catalog contains 829 unique geometries and 1,028 shape
realizations. Its typed-array pools occupy 4,363,249 bytes (about 5,263 bytes
per unique geometry); this number deliberately excludes JavaScript strings and
map overhead.

Candidate generation currently dominates the measured optimizer time. Tracked
temporary collection counts range from 5.36 to 8.83 per cell. Process heap
deltas without `--expose-gc` are noisy and are reported by the JSON output only
as a best-effort diagnostic, not as an allocation guarantee. The JSON report
also benchmarks triangle-centric sparse cell discovery and lazy 16³ local-mask
materialization separately from optimizer-only workloads.

The deterministic sparse plane workload contains 18,432 triangles and produces
12,901 surface cells. Cell discovery ran at about 238k triangles/s; lazy local
mask materialization for the first 1,024 cells ran at about 3,451 masks/s.
