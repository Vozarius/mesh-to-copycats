# GitHub Pages runtime catalog

`catalog.tar.gz` is generated from the six browser runtime files in
`generated/catalog`. It intentionally excludes `extraction-audit.json`, source
JARs and extractor run data. The Pages workflow extracts it before the Vite
build so the deployed editor uses the production catalog instead of the fixture
fallback.

Regenerate it from the repository root after rebuilding the catalog:

```text
tar -czf .github/pages/catalog.tar.gz -C generated/catalog generated-blocks.bin generated-shapes.bin metadata.json material-palette.json neighbor-transitions.bin runtime-metadata.json
```
