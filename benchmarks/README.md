# Optimizer benchmark

`pnpm benchmark` runs 10,000 deterministic cells in each of the `simple`,
`stairs`, `byte`, `complex`, and `mixed` workloads. The output is JSON and
includes throughput, average stage counts, the percentage refined to 16^3,
stage timings, occupancy memory, tracked temporary allocations, and a
best-effort process heap delta.

For a quick smoke run:

```text
pnpm benchmark -- --cells 25
```

`--workload` selects one workload and `--mode` selects the refinement mode.
Mesh voxelization is not part of milestone 1, so its timing field remains zero;
synthetic occupancy preparation is reported separately.

See [latest.md](latest.md) for the most recent checked-in summary.
