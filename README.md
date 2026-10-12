# HolySheet – Figma Plugin

Internal Figma plugin by DevExpress. Automatically arranges icon variants inside `ComponentSet` nodes into a structured grid based on their variant properties.

Designed specifically for DevExpress icon libraries to keep sheets consistent, clean, and easy to maintain.

---

## How it works

The plugin reads four variant properties from each `ComponentSet` and uses them to calculate a grid layout:

| Property | Role in layout |
|----------|----------------|
| `Set` | Horizontal blocks — `fluent`, `desktop_classic`, `blazor_classic` (other values follow alphabetically) |
| `Style` | Vertical sections within a block — `regular`, `light`, `filled` (other values follow alphabetically) |
| `Palette` | Rows within each Style section — `neutral` first, `colored` second (other values follow alphabetically). Sets that still use the old `Color` property are laid out the same way |
| `Size` | Columns within each block (sorted numerically) |

After positioning all variants, the plugin:
- Resizes each `ComponentSet` to fit its content
- Sets `Center / Center` constraints on every variant and all its inner layers recursively
- Places the sets side by side, sorted by name (whole-page mode only) and zooms in

The top-left variant becomes the set's default variant in Figma, so the order of Set, Style and palette values decides which variant instances get by default.

---

## Usage

Run the plugin in one of two modes:

**Selection** — select component sets, any of their variants or layers, or frames, sections and groups that contain sets. Only those sets are laid out; they stay where they are. A selection with no sets in it changes nothing and says so.

**Whole page** — run with nothing selected. Every `ComponentSet` on the current page is laid out. The sets lying directly on the page are then lined up in one row, sorted by name, with a gap between them — including sets that were skipped because of an error, so nothing overlaps. Sets inside frames and sections keep their place.

---

## Pre-checks

Before any layout is applied, the plugin validates the data:

**Rotation check** — if any variant has `Rotation ≠ 0`, the plugin stops entirely and inserts a styled text report on the canvas, grouped by `ComponentSet`. No layout is applied until rotations are fixed.

**Duplicate variants** — if two variants share the same combination of property values, the plugin reports the conflict and skips that set.

**Missing properties** — if a `ComponentSet` is missing `Style`, `Palette` (or the old `Color`), or `Size` properties, it is skipped with an error message.

**Errors** — a set that fails to lay out (for example, one Figma reports as having errors) is reported and skipped; the other sets are still processed. Any other failure stops the plugin with a message instead of leaving it hanging.

---

## Configuration

Adjust layout constants in the `CONFIG` block at the top of `code.ts`:

```ts
const CONFIG = {
  padding: 20,         // inner padding inside each ComponentSet
  step: 52,            // grid cell size (px)
  gapBetweenBlocks: 52, // gap between Set-blocks inside one ComponentSet
  gapBetweenSets: 20,  // gap between ComponentSet nodes on canvas (auto mode only)
  props: {
    set: "Set",
    style: "Style",
    palette: "Palette",
    size: "Size"
  },
  legacyPaletteProp: "Color",                                // read when a set has no Palette property
  setOrder: ["fluent", "desktop_classic", "blazor_classic"], // block order, left to right
  styleOrder: ["regular", "light", "filled"],                // section order, top to bottom
  paletteOrder: ["neutral", "colored"]                       // row order within a section
};
```

---

## Development

`code.ts` is compiled to `code.js`, which Figma loads — commit both.

```bash
npm ci
npm test   # builds code.js and runs the layout tests in test/
```
