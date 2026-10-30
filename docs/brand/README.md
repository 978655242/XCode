# Brand assets

| Brand  | Directory                     | Description                                                                                                                     |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Aiscoo | [`aiscoo/`](aiscoo/README.md) | App icon, app logo (static and animated), splash page, and the "ai" mark. Open `aiscoo/preview.html` to see everything at once. |

## Conventions

- Each brand has its own directory, with `preview.html`, `README.md`, and the generator scripts in `source/`.
- Change parameters in `source/` and regenerate. Don't hand-edit generated SVG or PNG files.
- `.skill-archive/logo-creator/Aiscoo-Logo-Final/` is an exact mirror of `docs/brand/aiscoo/`, including generators, previews, SVGs and binary formats. Update the canonical package here, then use its [synchronization command](aiscoo/README.md#设计工具镜像); the archive does not maintain a separate design.
- Aiscoo is the active product brand. The `ai` mark and lowercase `aiscoo` wordmark share the same light/dark SVG source, with capsule eyes in static assets and a 10-second smile-and-head-bounce cycle at animated entry points. Theme selection, reduced-motion behavior and current placements follow the [icon and display-name specification](../aiscoo/branding/icon-spec.md). Production resources are generated into `packages/ui/src/aiscoo/brand/assets`, `packages/desktop/build`, `packages/web/public` and `public/logo/icons` (the standalone share app reuses `packages/web/public`); runtime code does not read this documentation directory.
- Regenerate production assets with `python3 scripts/aiscoo/generate-icons.py`. The [brand integration checklist](../aiscoo/branding/aiscoo-migration.md) records display-name, packaging and compatibility coverage.
