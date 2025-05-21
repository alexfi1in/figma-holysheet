/** =============================================
 *  HolySheet — ComponentSet Auto‑Layout Plugin
 *  Author: Your Name
 *  Description: Arranges variants in a predictable
 *  Size (X) × Style×Color (Y) grid with optional
 *  Set‑by‑Set blocks. Implements deterministic keys
 *  by alphabetically sorting propertyKeys.
 *  ============================================= */

/** ========== [ CONFIG ] ========== **/
const CONFIG = {
  padding: 20,          // inner padding around grid
  step: 52,             // cell size (width/height)
  gapBetweenSets: 20,   // gap between Set blocks on X
  props: {
    set: "Set",
    style: "Style",
    color: "Color",
    size: "Size"
  }
} as const;

/** ========== [ UTILS ] ========== **/
function log(message: string, type: 'info' | 'error' = 'info'): void {
  if (type === 'error') {
    figma.notify(message, { error: true });
    console.error('[HolySheet]', message);
  } else {
    console.log('[HolySheet]', message);
  }
}

function resetConstraintsRecursively(node: SceneNode): void {
  if ("constraints" in node) {
    node.constraints = { horizontal: "MIN", vertical: "MIN" };
  }
  if ("children" in node) {
    for (const child of node.children) resetConstraintsRecursively(child);
  }
}

function variantKey(properties: Record<string, string>, keys: string[]): string {
  return keys.map(k => properties[k] ?? "").join("|");
}

function sortVariantsByName(variants: Variant[]): void {
  variants.sort((a, b) => a.node.name.localeCompare(b.node.name));
}

function sortComponentSetsByNameAsc(sets: ComponentSetNode[]): ComponentSetNode[] {
  return sets.slice().sort((a, b) => a.name.localeCompare(b.name));
}

function sortColorKeysWithLetterPriority(keys: string[]): string[] {
  return keys.sort((a, b) => {
    const priority = (k: string) => {
      const first = k[0]?.toLowerCase();
      if (first === 'n') return 0;   // neutrals first
      if (first === 's') return 1;   // semantic second
      return 2;                      // others
    };
    const pa = priority(a);
    const pb = priority(b);
    return pa === pb ? a.localeCompare(b) : pa - pb;
  });
}

/** ========== [ TYPES ] ========== **/
type Variant = { node: ComponentNode; properties: Record<string, string> };

type VariantInfo = {
  propertyKeys: string[];
  propertyValues: Record<string, Set<string>>;
  variants: Variant[];
};

/** ========== [ ANALYSIS ] ========== **/
function readVariantProperties(componentSet: ComponentSetNode): VariantInfo | null {
  const propertyKeysSet = new Set<string>();
  const propertyValues: Record<string, Set<string>> = {};
  const variants: Variant[] = [];

  for (const child of componentSet.children) {
    if (child.type !== 'COMPONENT') continue;

    let properties: Record<string, string>;
    try {
      properties = child.variantProperties ?? {};
    } catch {
      log('Failed to read variant properties. They may be broken or conflicting.', 'error');
      figma.closePlugin();
      return null;
    }

    variants.push({ node: child, properties });

    for (const [key, value] of Object.entries(properties)) {
      propertyKeysSet.add(key);
      if (!propertyValues[key]) propertyValues[key] = new Set();
      propertyValues[key].add(value);
    }
  }

  if (!variants.length) {
    log('No variants found in the ComponentSet.', 'error');
    figma.closePlugin();
    return null;
  }
  if (!propertyKeysSet.size) {
    log('No variant properties detected in the ComponentSet.', 'error');
    figma.closePlugin();
    return null;
  }

  sortVariantsByName(variants);

  return {
    propertyKeys: Array.from(propertyKeysSet).sort(), // ★ deterministic order
    propertyValues,
    variants
  };
}

function validateVariantUniqueness(variantInfo: VariantInfo): boolean {
  const seen = new Set<string>();
  for (const variant of variantInfo.variants) {
    const key = variantKey(variant.properties, variantInfo.propertyKeys);
    if (seen.has(key)) {
      log(`Duplicate variant properties detected: ${key}.`, 'error');
      figma.closePlugin();
      return false;
    }
    seen.add(key);
  }
  return true;
}

/** ========== [ LAYOUT ] ========== **/
function planLayoutWithSizeOnXColorOnY(
  variantInfo: VariantInfo,
  step = CONFIG.step,
  setProp = CONFIG.props.set,
  styleProp = CONFIG.props.style,
  colorProp = CONFIG.props.color,
  sizeProp = CONFIG.props.size
): Map<string, { x: number; y: number }> {
  // group by Set
  const setGroups = new Map<string, Variant[]>();
  for (const variant of variantInfo.variants) {
    const setVal = variant.properties[setProp] ?? 'default';
    if (!setGroups.has(setVal)) setGroups.set(setVal, []);
    setGroups.get(setVal)!.push(variant);
  }

  // global ordered keys
  const styles = Array.from(variantInfo.propertyValues[styleProp] ?? []).sort().reverse();
  const colors = sortColorKeysWithLetterPriority(Array.from(variantInfo.propertyValues[colorProp] ?? []));
  const sizes  = Array.from(variantInfo.propertyValues[sizeProp] ?? []).sort((a, b) => Number(a) - Number(b));

  log(`[Sort] Style: ${styles}`);
  log(`[Sort] Color: ${colors}`);
  log(`[Sort] Size: ${sizes}`);

  const idx = <T extends string>(arr: T[]) => new Map(arr.map((k, i) => [k, i] as const));
  const styleIdx = idx(styles);
  const colorIdx = idx(colors);
  const sizeIdx  = idx(sizes);

  const blockWidth = sizes.length * step;
  let baseX = 0;
  const positionMap = new Map<string, { x: number; y: number }>();

  const sortedSetKeys = Array.from(setGroups.keys()).sort().reverse();
  for (const setKey of sortedSetKeys) {
    for (const variant of setGroups.get(setKey)!) {
      const key = variantKey(variant.properties, variantInfo.propertyKeys);
      const sx = sizeIdx.get(variant.properties[sizeProp] ?? '') ?? 0;
      const sy = styleIdx.get(variant.properties[styleProp] ?? '') ?? 0;
      const cy = colorIdx.get(variant.properties[colorProp] ?? '') ?? 0;

      const x = baseX + sx * step + CONFIG.padding;
      const yCellTop = sy * (colors.length * step) + cy * step + CONFIG.padding;
      const y = yCellTop + step / 2 - variant.node.height / 2;

      positionMap.set(key, { x, y });
    }
    baseX += blockWidth + step; // move to next Set block
  }

  return positionMap;
}

/** ========== [ APPLY ] ========== **/
function transformLayout(
  info: VariantInfo,
  posMap: Map<string, { x: number; y: number }>,
  setNode: ComponentSetNode
): void {
  // zero‑out before repositioning (keeps diff cleaner)
  for (const v of info.variants) {
    resetConstraintsRecursively(v.node);
    v.node.x = v.node.y = 0;
  }
  // apply positions
  for (const v of info.variants) {
    const key = variantKey(v.properties, info.propertyKeys);
    const p = posMap.get(key);
    if (!p) continue;
    v.node.x = p.x;
    v.node.y = p.y;
  }
  // re‑order children visually (top‑to‑bottom, left‑to‑right)
  const ordered = setNode.children.slice().sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
  ordered.forEach((n, i) => setNode.insertChild(i, n));

  // resize ComponentSet frame to fit
  if (!setNode.children.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of setNode.children) {
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x + c.width);
    maxY = Math.max(maxY, c.y + c.height);
  }
  setNode.children.forEach(c => {
    c.x -= (minX - CONFIG.padding);
    c.y -= (minY - CONFIG.padding);
  });
  setNode.resize(maxX - minX + CONFIG.padding * 2, maxY - minY + CONFIG.padding * 2);
}

/** ========== [ MAIN ] ========== **/
function run(): void {
  const allSets = figma.currentPage.findAll(n => n.type === 'COMPONENT_SET') as ComponentSetNode[];
  if (!allSets.length) {
    log('No ComponentSets found on the page.', 'error');
    figma.closePlugin();
    return;
  }

  const selectedSets = figma.currentPage.selection.filter(n => n.type === 'COMPONENT_SET') as ComponentSetNode[];
  const autoMode = !selectedSets.length;
  const sets = sortComponentSetsByNameAsc(autoMode ? allSets : selectedSets);

  let processed = 0;
  let offsetX = 0; // for auto‑mode block arrangement

  for (const setNode of sets) {
    log(`Processing ComponentSet: ${setNode.name}`);

    const variantInfo = readVariantProperties(setNode);
    if (!variantInfo) continue;
    if (!validateVariantUniqueness(variantInfo)) continue;

    const posMap = planLayoutWithSizeOnXColorOnY(variantInfo);
    transformLayout(variantInfo, posMap, setNode);

    if (autoMode) {
      setNode.x = offsetX;
      setNode.y = 0;
      offsetX += setNode.width + CONFIG.gapBetweenSets;
    }

    processed++;
    log(`📐 Final component size: ${setNode.width}×${setNode.height}`);
  }

  if (autoMode && sets[0]?.parent) {
    const parent = sets[0].parent!;
    for (let i = sets.length - 1; i >= 0; i--) parent.insertChild(0, sets[i]);
  }

  figma.viewport.scrollAndZoomIntoView(sets);
  figma.notify(`✅ Done! ${processed} ComponentSet${processed === 1 ? '' : 's'} updated.`);
  figma.closePlugin();
}

run();
