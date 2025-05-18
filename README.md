# HolySheet – Figma Plugin

![cover-small@2x](https://github.com/user-attachments/assets/18069bbc-5b2e-46dc-a31e-63518d9dfb0b)

**HolySheet** is an internal plugin created by DevExpress for managing and auto-arranging large sets of icon variants inside a Figma `ComponentSet`.

It is tailored specifically for our icon libraries to ensure:
- Visual consistency
- Clean layer structure
- Efficient grid-based layout based on variant properties



## ⚙️ How it works

### 🔁 Flow Overview

```
[Selection or whole page]
        ↓
[Analyze variants]
        ↓
[Validate + deduplicate]
        ↓
[Plan grid layout]
        ↓
[Reset constraints to MIN/MIN]
        ↓
[Position + reorder variants]
        ↓
[Resize each ComponentSet to fit]
        ↓
[Reposition sets horizontally]
        ↓
[Zoom to view] → ✅ Done!
```

### 🧭 Grid Layout Strategy

- **Set** → horizontal blocks
- **Style + Color** → vertical rows and lines
- **Size** → horizontal columns inside each block



## 🧪 Behavior Summary

1. ✅ Accepts:
   - Single or multiple selected `ComponentSet` nodes
   - If nothing is selected, processes **all ComponentSets** on the page

2. 🧹 Cleans:
   - Resets variant constraints (`MIN/MIN`) to avoid layout stretching issues

3. 📐 Positions:
   - Calculates layout using properties: `Set`, `Style`, `Color`, and `Size`
   - Sorts variants alphabetically
   - Places `ComponentSets` side-by-side with padding

4. 🎯 Finishes:
   - Resizes each `ComponentSet` to fit its content
   - Zooms into updated sets
   - Notifies user with success summary



## 🔧 Customization

Adjust layout logic in `CONFIG` section of the plugin code:
```ts
const CONFIG = {
  padding: 20,
  step: 48,
  gapBetweenSets: 40,
  props: {
    set: "Set",
    style: "Style",
    color: "Color",
    size: "Size"
  }
};
```
