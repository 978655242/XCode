# Brand assets

| Brand  | Directory                     | Description                                                                                                                     |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Aiscoo | [`aiscoo/`](aiscoo/README.md) | App icon, app logo (static and animated), splash page, and the "ai" mark. Open `aiscoo/preview.html` to see everything at once. |

## Conventions

- Each brand has its own directory, with `preview.html`, `README.md`, and the generator scripts in `source/`.
- Change parameters in `source/` and regenerate. Don't hand-edit generated SVG or PNG files.
- `.skill-archive/logo-creator/` holds a mirror of what the design tool produced during work. The source of truth is this directory.
- Aiscoo is the active product brand. Production resources are generated into `packages/ui/src/xwork/brand/assets`, `packages/desktop/build`, `packages/web/public` and `public/logo/icons` (the standalone share app reuses `packages/web/public`); runtime code does not read this documentation directory.
- Regenerate production assets with `python3 scripts/xcode/generate-icons.py`. The [brand integration checklist](../xcode/branding/aiscoo-migration.md) records display-name, packaging and compatibility coverage.
