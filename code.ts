/// <reference types="@figma/plugin-typings" />
/** =============================================
 *  HolySheet — ComponentSet Auto‑Layout Plugin
 *  Modular (IIFE) refactor: Logger, Inspector, Layout
 *  ============================================= */


/** ========== [ CONFIG ] ========== **/
const CONFIG = {
  padding: 20,
  step: 52,
  gapBetweenBlocks: 52,
  gapBetweenSets: 20,
  props: { set: "Set", style: "Style", palette: "Palette", size: "Size" },
  // The palette property was called Color before 2026-10
  legacyPaletteProp: "Color",
  // Known values in layout order; unknown ones follow alphabetically. The top-left variant
  // (first Set, Style and palette, smallest Size) becomes the set's default variant in Figma.
  setOrder: ["fluent", "desktop_classic", "blazor_classic"],
  styleOrder: ["regular", "light", "filled"],
  paletteOrder: ["neutral", "colored"]
} as const;

/** ========== [ LOGGER ] ========== **/
const Logger = {
  info: (msg: string) => console.log("[HolySheet]", msg),
  error: (msg: string) => {
    figma.notify(msg, { error: true, timeout: 5000 });
    console.error("[HolySheet]", msg);
  },
};

/** ========== [ TYPES ] ========== **/
type Variant = { node: ComponentNode; properties: Record<string, string> };
interface VariantInfo {
  propertyKeys: string[];
  propertyValues: Record<string, Set<string>>;
  variants: Variant[];
}

/** ========== [ INSPECTOR ] ========== **/
const Inspector = (() => {
  function variantKey(props: Record<string, string>, keys: string[]): string {
    return keys.map(k => props[k] ?? "").join("|");
  }

  function sortByName(items: Variant[]) {
    items.sort((a, b) => a.node.name.localeCompare(b.node.name));
  }

  function readVariantProperties(set: ComponentSetNode): VariantInfo | null {
    const keySet = new Set<string>();
    const valMap: Record<string, Set<string>> = {};
    const variants: Variant[] = [];

    for (const child of set.children) {
      if (child.type !== "COMPONENT") continue;
      const props = child.variantProperties ?? {};
      variants.push({ node: child, properties: props });
      for (const [k, v] of Object.entries(props)) {
        keySet.add(k);
        if (!valMap[k]) valMap[k] = new Set<string>();
        valMap[k].add(v);
      }
    }

    if (!variants.length) return null;

    sortByName(variants);
    return { propertyKeys: Array.from(keySet).sort(), propertyValues: valMap, variants };
  }

  function validate(info: VariantInfo): string | null {
    const seen = new Set<string>();
    for (const v of info.variants) {
      const key = variantKey(v.properties, info.propertyKeys);
      if (seen.has(key)) return `Duplicate variant properties: ${key}`;
      seen.add(key);
    }
    return null;
  }

  function resetConstraints(node: ComponentNode) {
    node.constraints = { horizontal: "MIN", vertical: "MIN" };
  }

  function applyCenterConstraints(node: SceneNode) {
    if ("constraints" in node) node.constraints = { horizontal: "CENTER", vertical: "CENTER" };
    if ("children" in node) node.children.forEach(applyCenterConstraints);
  }

  function hasNonZeroRotation(node: ComponentNode): boolean {
    return Math.abs(node.rotation) > 0.001;
  }

  function collectRotationIssuesGrouped(set: ComponentSetNode): { set: string; variants: string[] } | null {
    const variants: string[] = [];
    for (const child of set.children) {
      if (child.type !== "COMPONENT") continue;
      if (hasNonZeroRotation(child)) variants.push(child.name);
    }
    return variants.length ? { set: set.name, variants } : null;
  }

  return { variantKey, readVariantProperties, validate, resetConstraints, applyCenterConstraints, collectRotationIssuesGrouped };
})();

/** ========== [ LAYOUT ] ========== **/
const LayoutService = (() => {
  function sortByOrder(keys: string[], order: readonly string[]): string[] {
    const rank = (k: string) => (order.indexOf(k) === -1 ? order.length : order.indexOf(k));
    return keys.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  }

  function plan(info: VariantInfo): Map<string, { x: number; y: number }> | null {
    const { step, padding, gapBetweenBlocks, props, legacyPaletteProp } = CONFIG;
    const { set: setProp, style: styleProp, size: sizeProp } = props;
    const paletteProp = info.propertyValues[props.palette] ? props.palette : legacyPaletteProp;

    const styles = sortByOrder(Array.from(info.propertyValues[styleProp] ?? []), CONFIG.styleOrder);
    const palettes = sortByOrder(Array.from(info.propertyValues[paletteProp] ?? []), CONFIG.paletteOrder);
    const sizes  = Array.from(info.propertyValues[sizeProp] ?? []).sort((a, b) => Number(a) - Number(b));

    if (!sizes.length || !styles.length || !palettes.length) return null;

    // group variants by Set
    const setGroups = new Map<string, Variant[]>();
    for (const v of info.variants) {
      const key = v.properties[setProp] ?? "default";
      let arr = setGroups.get(key);
      if (!arr) {
        arr = [];
        setGroups.set(key, arr);
      }
      arr.push(v);
    }

    const idx = (arr: string[]) => new Map(arr.map((v, i) => [v, i] as const));
    const iStyle = idx(styles), iPalette = idx(palettes), iSize = idx(sizes);

    const pos = new Map<string, { x: number; y: number }>();
    let baseX = 0;
    const blockW = sizes.length * step;

    for (const setKey of sortByOrder(Array.from(setGroups.keys()), CONFIG.setOrder)) {
      for (const v of setGroups.get(setKey)!) {
        const sx = iSize.get(v.properties[sizeProp] ?? "") ?? 0;
        const sy = iStyle.get(v.properties[styleProp] ?? "") ?? 0;
        const py = iPalette.get(v.properties[paletteProp] ?? "") ?? 0;
        const x = baseX + sx * step + padding;
        const cellTop = sy * (palettes.length * step) + py * step + padding;
        const y = cellTop + step / 2 - v.node.height / 2;
        pos.set(Inspector.variantKey(v.properties, info.propertyKeys), { x, y });
      }
      baseX += blockW + gapBetweenBlocks;
    }
    return pos;
  }

  function apply(info: VariantInfo, map: Map<string, { x: number; y: number }>, setNode: ComponentSetNode) {
    info.variants.forEach(v => {
      Inspector.resetConstraints(v.node);
      const p = map.get(Inspector.variantKey(v.properties, info.propertyKeys));
      v.node.x = p?.x ?? 0;
      v.node.y = p?.y ?? 0;
    });

    const ordered = setNode.children.slice().sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
    ordered.forEach((n, i) => setNode.insertChild(i, n));

    if (!setNode.children.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    setNode.children.forEach(c => {
      minX = Math.min(minX, c.x); minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x + c.width); maxY = Math.max(maxY, c.y + c.height);
    });
    setNode.children.forEach(c => { c.x -= (minX - CONFIG.padding); c.y -= (minY - CONFIG.padding); });
    setNode.resizeWithoutConstraints(maxX - minX + CONFIG.padding * 2, maxY - minY + CONFIG.padding * 2);
    info.variants.forEach(v => Inspector.applyCenterConstraints(v.node));
  }

  return { plan, apply };
})();

/** ========== [ REPORT ] ========== **/
type SetProblems = { set: ComponentSetNode; problems: string[] };
const REPORT_NAME = "HolySheet report";
const REPORT_KEY = "holysheet"; // plugin data that marks the plugin's own report, so a designer's text is never removed

function removeOldReports(page: PageNode) {
  for (const node of page.children.slice()) {
    if (node.getPluginData(REPORT_KEY) === "report") node.remove();
  }
}

// A text on the canvas listing every problem by set, placed above the first set with problems
async function createReport(groups: SetProblems[]): Promise<void> {
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  await figma.loadFontAsync({ family: "Inter", style: "Bold" });
  const text = figma.createText();
  text.name = REPORT_NAME;
  text.setPluginData(REPORT_KEY, "report");
  try { text.fontName = { family: "Inter", style: "Regular" }; } catch { /* keep default font if unavailable */ }

  const title = "HolySheet changed nothing. Fix these problems and run it again:";
  const lines: string[] = [title, ""];

  type Range = { start: number; end: number; kind: "title" | "set" | "variant" };
  const ranges: Range[] = [{ start: 0, end: title.length, kind: "title" }];

  let offset = title.length + 2;
  groups.forEach((g, gi) => {
    const setLine = `• ${g.set.name}`;
    lines.push(setLine);
    ranges.push({ start: offset, end: offset + setLine.length, kind: "set" });
    offset += setLine.length + 1;

    g.problems.forEach(p => {
      const problemLine = `  – ${p}`;
      lines.push(problemLine);
      ranges.push({ start: offset, end: offset + problemLine.length, kind: "variant" });
      offset += problemLine.length + 1;
    });

    if (gi < groups.length - 1) { lines.push(""); offset += 1; }
  });

  text.characters = lines.join("\n");
  text.textAutoResize = "HEIGHT";
  text.fontSize = 12;

  for (const r of ranges) {
    if (r.kind === "title") {
      text.setRangeFontName(r.start, r.end, { family: "Inter", style: "Bold" });
      text.setRangeFontSize(r.start, r.end, 12);
      text.setRangeFills(r.start, r.end, [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }]);
    } else if (r.kind === "set") {
      text.setRangeFontName(r.start, r.end, { family: "Inter", style: "Bold" });
      text.setRangeFontSize(r.start, r.end, 12);
    } else {
      text.setRangeFontSize(r.start, r.end, 12);
    }
  }

  // On the page itself, in page coordinates: a set may lie inside a frame
  figma.currentPage.appendChild(text);
  const anchor = groups[0].set;
  const box = anchor.absoluteBoundingBox ?? { x: anchor.x, y: anchor.y };
  text.x = box.x;
  text.y = box.y - text.height - 40;
  figma.viewport.scrollAndZoomIntoView([text]);
}

/** ========== [ MAIN ] ========== **/
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

// The sets a selection points at: selected sets, the set around a selected variant or layer,
// and the sets inside selected frames, sections and groups
function setsInSelection(selection: readonly SceneNode[]): ComponentSetNode[] {
  const found = new Set<ComponentSetNode>();
  for (const node of selection) {
    let n: BaseNode | null = node;
    while (n && n.type !== "COMPONENT_SET") n = n.parent;
    if (n) found.add(n as ComponentSetNode);
    else if ("findAllWithCriteria" in node) node.findAllWithCriteria({ types: ["COMPONENT_SET"] }).forEach(s => found.add(s));
  }
  return Array.from(found);
}

type Plan = { set: ComponentSetNode; info: VariantInfo; positions: Map<string, { x: number; y: number }> };

// Checks one set without changing it: its layout plan, or every problem that stops it from being laid out
function check(setNode: ComponentSetNode): { plan: Plan } | { problems: string[] } {
  const problems: string[] = [];
  try {
    const rotated = Inspector.collectRotationIssuesGrouped(setNode);
    if (rotated) problems.push(...rotated.variants.map(v => `Rotation ≠ 0, set it to 0: ${v}`));
    const info = Inspector.readVariantProperties(setNode);
    if (!info) return { problems: [...problems, "No variants."] };
    const duplicate = Inspector.validate(info);
    if (duplicate) problems.push(duplicate);
    const positions = LayoutService.plan(info);
    if (!positions) problems.push("Missing required variant properties (Style/Palette/Size).");
    return problems.length || !positions ? { problems } : { plan: { set: setNode, info, positions } };
  } catch (e) {
    return { problems: [...problems, `Can't read the set: ${errorMessage(e)}`] };
  }
}

// Whole-page mode lines up the sets lying directly on the page, sorted by name, and orders their layers
// the same way. Sets inside frames and sections keep their place.
function arrangeRow(sets: ComponentSetNode[]) {
  const row = sets.filter(s => s.parent?.type === "PAGE");
  let offsetX = 0;
  for (const s of row) { s.x = offsetX; s.y = 0; offsetX += s.width + CONFIG.gapBetweenSets; }
  for (let i = row.length - 1; i >= 0; i--) row[i].parent!.insertChild(0, row[i]);
}

async function run() {
  const page = figma.currentPage;
  await page.loadAsync();
  removeOldReports(page);
  const selection = page.selection;
  const auto = !selection.length;
  const sets = (auto ? page.findAllWithCriteria({ types: ["COMPONENT_SET"] }) : setsInSelection(selection))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!sets.length) {
    Logger.error(auto
      ? "No ComponentSets on page."
      : "Nothing to lay out: select component sets, their variants, or frames that contain them.");
    return;
  }

  // Every problem is a show-stopper: check all sets first, change nothing until all of them are fine
  const plans: Plan[] = [];
  const failed: SetProblems[] = [];
  for (const setNode of sets) {
    const result = check(setNode);
    if ("plan" in result) plans.push(result.plan);
    else failed.push({ set: setNode, problems: result.problems });
  }

  if (failed.length) {
    const count = failed.reduce((n, g) => n + g.problems.length, 0);
    Logger.error(`Found ${count} problem${count === 1 ? "" : "s"} in ${failed.length} set${failed.length === 1 ? "" : "s"}. ` +
      "Nothing was changed — see the report on the canvas.");
    try { await createReport(failed); }
    catch (e) { Logger.error(`Could not create the report (${errorMessage(e)}). First problem in "${failed[0].set.name}": ${failed[0].problems[0]}`); }
    return;
  }

  for (const { set, info, positions } of plans) {
    Logger.info(`Processing: ${set.name}`);
    try { LayoutService.apply(info, positions, set); }
    catch (e) { throw new Error(`"${set.name}": ${errorMessage(e)}`); }
    Logger.info(`📐 Size: ${set.width}×${set.height}`);
  }

  if (auto) arrangeRow(sets);

  figma.viewport.scrollAndZoomIntoView(sets);
  figma.notify(`✅ Done! ${plans.length} ComponentSet${plans.length === 1 ? "" : "s"} updated.`);
}

(async function main() {
  try { await run(); }
  catch (e) { Logger.error(`HolySheet stopped: ${errorMessage(e)}`); }
  finally { figma.closePlugin(); }
})();
