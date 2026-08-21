# Geometry optimizer harness

Run a named synthetic target and include the 16^3 ASCII comparison:

```text
pnpm harness -- --preset stairs --mode BALANCED --diff
```

Targets may also be selected with `--shape-id <id>` or `--mask16 <hex>`.
Prefix a mask argument with `@` to read its 1024 hexadecimal characters from a
file. The machine-readable JSON result is written to stdout; `--diff` writes the
slice visualization to stderr so stdout remains valid JSON.

Use `pnpm harness -- --help` for the complete preset and option list.

Generate and structurally verify a production multipart Copycats schematic,
optionally retaining the exact gzip NBT for the pinned NeoForge runtime check:

```text
pnpm schematic:verify -- generated/catalog --out tools/mod-extractor/neoforge/run/m2c-extractor/verification.nbt
```
