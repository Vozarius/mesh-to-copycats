# Latest benchmark

Recorded on 2026-08-13 with Node 24.19.0, Windows x64, `BALANCED` mode and
10,000 deterministic targets per workload. Run `pnpm benchmark` to reproduce
the full JSON report.

| Workload | cells/s | generated | after 4^3 | after 8^3 | reached 16^3 | materialized bytes/cell |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| simple | 6,238 | 64.00 | 24.86 | 3.52 | 11.05% | 109.73 |
| stairs | 7,264 | 64.00 | 22.13 | 0.73 | 0.00% | 19.63 |
| byte | 7,306 | 64.00 | 24.30 | 0.76 | 4.06% | 37.88 |
| complex | 8,120 | 60.56 | 35.00 | 4.12 | 91.72% | 541.61 |
| mixed | 6,982 | 63.15 | 27.23 | 2.46 | 26.63% | 179.73 |

The packed fixture catalog contains 829 unique geometries and 1,028 shape
realizations. Its typed-array pools occupy 4,363,249 bytes (about 5,263 bytes
per unique geometry); this number deliberately excludes JavaScript strings and
map overhead.

Candidate generation currently dominates the measured optimizer time. Tracked
temporary collection counts range from 5.36 to 8.83 per cell. Process heap
deltas without `--expose-gc` are noisy and are reported by the JSON output only
as a best-effort diagnostic, not as an allocation guarantee. Mesh voxelization
is outside milestone 1, so the reserved voxelization timing remains zero.
