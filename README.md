# HolySheet — Figma Plugin

**HolySheet** is an internal plugin created by DevExpress for managing and auto-arranging large sets of icon variants inside a Figma ComponentSet.

It was designed specifically for our icon libraries to ensure visual consistency, clean layer order, and efficient layout — all based on variant properties such as `Set`, `Style`, `Color`, and `Size`.

# How it works

1. **Selection check**  
   The plugin verifies that exactly one `ComponentSet` is selected. If not, it exits with an error.

2. **Variant parsing**  
   It analyzes all variants inside the selected `ComponentSet`, reads their `variantProperties`, and validates them.  
   If any variant is broken or shares duplicate property values, the plugin stops and informs the user.

3. **Layout planning**  
   It generates a grid layout using the following logic:
   - `Set` → horizontal blocks (grouped along X)
   - `Style` and `Color` → vertical rows and lines (Y)
   - `Size` → individual columns (X)

4. **Constraint cleanup**  
   All nested constraints on each variant are reset to `MIN/MIN` to prevent stretching or misalignment during positioning.

5. **Positioning & sorting**  
   Each variant is placed in its calculated position.  
   The children of the `ComponentSet` are then reordered by coordinates to maintain a clean layer structure.

6. **Auto-resize**  
   The `ComponentSet` is resized to tightly fit its children, applying uniform padding.

7. **Success message**  
   A success notification is shown when the operation completes.
