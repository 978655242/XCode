# Brand assets

| Brand  | Directory                     | Description                                                                                                                     |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Aiscoo | [`aiscoo/`](aiscoo/README.md) | App icon, app logo (static and animated), splash page, and the "ai" mark. Open `aiscoo/preview.html` to see everything at once. |

## Conventions

- Each brand has its own directory, with `preview.html`, `README.md`, and the generator scripts in `source/`.
- Change parameters in `source/` and regenerate. Don't hand-edit generated SVG or PNG files.
- `.skill-archive/logo-creator/` holds a mirror of what the design tool produced during work. The source of truth is this directory.
- The product is not yet using these assets. Swapping out the desktop icon (`packages/desktop/build/icon.*`) and `productName` belongs to the renaming work and follows the rules in `docs/xcode/UPSTREAM-EXTENSION.md`.
