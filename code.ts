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
  props: { set: "Set", style: "Style", color: "Color", size: "Size" }
} as const;

/** ========== [ LOGGER ] ========== **/
const Logger = (() => {
  type Level = "debug" | "info" | "error";
  const priority = { debug: 0, info: 1, error: 2 } as const;
  const current: Level = "info";
  function log(msg: string, l: Level = "info") {
    if (priority[l] < priority[current]) return;
    if (l === "error") {
      figma.notify(msg, { error: true, timeout: 5000 });
      console.error("[HolySheet]", msg);
    } else {
      console.log("[HolySheet]", msg);
    }
  }
  return { log };
})();

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

  function resetConstraints(node: SceneNode) {
    if ("constraints" in node) node.constraints = { horizontal: "MIN", vertical: "MIN" };
    if ("children" in node) node.children.forEach(resetConstraints);
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

  return { variantKey, readVariantProperties, validate, resetConstraints, collectRotationIssuesGrouped };
})();

/** ========== [ LAYOUT ] ========== **/
const LayoutService = (() => {
  function sortColorKeys(keys: string[]): string[] {
    return keys.sort((a, b) => {
      const p = (c: string) => (c[0]?.toLowerCase() === "n" ? 0 : c[0]?.toLowerCase() === "s" ? 1 : 2);
      const pa = p(a), pb = p(b);
      return pa === pb ? a.localeCompare(b) : pa - pb;
    });
  }

  function plan(info: VariantInfo): Map<string, { x: number; y: number }> | null {
    const { step, padding, gapBetweenBlocks, props } = CONFIG;
    const { set: setProp, style: styleProp, color: colorProp, size: sizeProp } = props;

    const styles = Array.from(info.propertyValues[styleProp] ?? []).sort().reverse();
    const colors = sortColorKeys(Array.from(info.propertyValues[colorProp] ?? []));
    const sizes  = Array.from(info.propertyValues[sizeProp] ?? []).sort((a, b) => Number(a) - Number(b));

    if (!sizes.length || !styles.length || !colors.length) return null;

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
    const iStyle = idx(styles), iColor = idx(colors), iSize = idx(sizes);

    const pos = new Map<string, { x: number; y: number }>();
    let baseX = 0;
    const blockW = sizes.length * step;

    for (const setKey of Array.from(setGroups.keys()).sort().reverse()) {
      for (const v of setGroups.get(setKey)!) {
        const sx = iSize.get(v.properties[sizeProp] ?? "") ?? 0;
        const sy = iStyle.get(v.properties[styleProp] ?? "") ?? 0;
        const cy = iColor.get(v.properties[colorProp] ?? "") ?? 0;
        const x = baseX + sx * step + padding;
        const cellTop = sy * (colors.length * step) + cy * step + padding;
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
  }

  return { plan, apply };
})();

/** ========== [ ROTATION REPORT ] ========== **/
async function createRotationReport(
  groupedIssues: { set: string; variants: string[] }[],
  anchor: ComponentSetNode | undefined
): Promise<void> {
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  await figma.loadFontAsync({ family: "Inter", style: "Bold" });
  const text = figma.createText();
  try { text.fontName = { family: "Inter", style: "Regular" }; } catch { /* keep default font if unavailable */ }

  const title = "Rotation issues detected (please normalize Rotation to 0):";
  const lines: string[] = [title, ""];

  type Range = { start: number; end: number; kind: "title" | "set" | "variant" };
  const ranges: Range[] = [{ start: 0, end: title.length, kind: "title" }];

  let offset = title.length + 2;
  groupedIssues.forEach((g, gi) => {
    const setLine = `• ${g.set}`;
    lines.push(setLine);
    ranges.push({ start: offset, end: offset + setLine.length, kind: "set" });
    offset += setLine.length + 1;

    g.variants.forEach(v => {
      const variantLine = `  – ${v}`;
      lines.push(variantLine);
      ranges.push({ start: offset, end: offset + variantLine.length, kind: "variant" });
      offset += variantLine.length + 1;
    });

    if (gi < groupedIssues.length - 1) { lines.push(""); offset += 1; }
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

  text.x = anchor?.x ?? 0;
  text.y = (anchor?.y ?? 0) - 40;
  figma.currentPage.appendChild(text);
  figma.viewport.scrollAndZoomIntoView([text]);
}

/** ========== [ MAIN ] ========== **/
(async function run() {
  await figma.currentPage.loadAsync();
  const allSets = figma.currentPage.findAllWithCriteria({ types: ["COMPONENT_SET"] });
  if (!allSets.length) { Logger.log("No ComponentSets on page.", "error"); figma.closePlugin(); return; }

  const selected = figma.currentPage.selection.filter(n => n.type === "COMPONENT_SET") as ComponentSetNode[];
  const auto = !selected.length;
  const sets = [...(auto ? allSets : selected)].sort((a, b) => a.name.localeCompare(b.name));

  const groupedIssues: { set: string; variants: string[] }[] = [];
  for (const setNode of sets) {
    const group = Inspector.collectRotationIssuesGrouped(setNode);
    if (group) groupedIssues.push(group);
  }

  if (groupedIssues.length) {
    Logger.log("Found nodes with Rotation ≠ 0. See generated report.", "error");
    try { await createRotationReport(groupedIssues, sets[0]); } catch { /* toast already shown */ }
    figma.closePlugin();
    return;
  }

  let processed = 0, offsetX = 0;
  for (const setNode of sets) {
    Logger.log(`Processing: ${setNode.name}`);
    const info = Inspector.readVariantProperties(setNode);
    if (!info) { Logger.log(`No variants in "${setNode.name}".`, "error"); continue; }
    const validationError = Inspector.validate(info);
    if (validationError) { Logger.log(validationError, "error"); continue; }
    const positions = LayoutService.plan(info);
    if (!positions) { Logger.log(`Missing required variant properties (Style/Color/Size) in "${setNode.name}".`, "error"); continue; }
    LayoutService.apply(info, positions, setNode);
    if (auto) { setNode.x = offsetX; setNode.y = 0; offsetX += setNode.width + CONFIG.gapBetweenSets; }
    processed++; Logger.log(`📐 Size: ${setNode.width}×${setNode.height}`);
  }

  if (!processed) {
    Logger.log("No ComponentSets were updated. Check the errors above.", "error");
    figma.closePlugin();
    return;
  }

  if (auto && sets[0]?.parent) {
    const parent = sets[0].parent!;
    for (let i = sets.length - 1; i >= 0; i--) parent.insertChild(0, sets[i]);
  }

  figma.viewport.scrollAndZoomIntoView(sets);
  figma.notify(`✅ Done! ${processed} ComponentSet${processed === 1 ? "" : "s"} updated.`);
  figma.closePlugin();
})();
