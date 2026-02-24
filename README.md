# HolySheet – Figma Plugin

Internal Figma plugin by DevExpress. Automatically arranges icon variants inside `ComponentSet` nodes into a structured grid based on their variant properties.

Designed specifically for DevExpress icon libraries to keep sheets consistent, clean, and easy to maintain.

---

## How it works

The plugin reads four variant properties from each `ComponentSet` and uses them to calculate a grid layout:

| Property | Role in layout |
|----------|----------------|
| `Set` | Horizontal blocks — each Set value gets its own column group |
| `Style` | Vertical sections within a block |
| `Color` | Rows within each Style section — sorted: `N…` first (None), `S…` second (Solid), rest alphabetically |
| `Size` | Columns within each block (sorted numerically) |

After positioning all variants, the plugin:
- Resizes each `ComponentSet` to fit its content
- Sets `Center / Center` constraints on every variant and all its inner layers recursively
- Places all sets side by side (in auto mode) and zooms in

---

## Usage

Run the plugin in one of two modes:

**Selected sets** — select one or more `ComponentSet` nodes before running. Only the selected sets are processed.

**Whole page** — run with nothing selected. All `ComponentSet` nodes on the current page are processed and arranged horizontally with a gap between them.

---

## Pre-checks

Before any layout is applied, the plugin validates the data:

**Rotation check** — if any variant has `Rotation ≠ 0`, the plugin stops entirely and inserts a styled text report on the canvas, grouped by `ComponentSet`. No layout is applied until rotations are fixed.

**Duplicate variants** — if two variants share the same combination of property values, the plugin reports the conflict and skips that set.

**Missing properties** — if a `ComponentSet` is missing `Style`, `Color`, or `Size` properties, it is skipped with an error message.

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
    color: "Color",
    size: "Size"
  }
};
```
