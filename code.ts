/** ========== [ CONFIG ] ========== **/
// Layout spacing and variant property names.
// Designers can adjust these to customize grid behavior.
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

/** ========== [ UTILS ] ========== **/
// Shows logs in Figma: useful for debugging or user feedback.
function log(message: string, type: 'info' | 'error' = 'info'): void {
  if (type === 'error') {
    figma.notify(message, { error: true });
    console.error('[HolySheet]', message);
  } else {
    console.log('[HolySheet]', message);
  }
}

// Resets all constraint settings inside a node (and its children) to prevent misalignment.
function resetConstraintsRecursively(node: SceneNode): void {
  if ("constraints" in node) {
    node.constraints = {
      horizontal: "MIN",
      vertical: "MIN"
    };
  }
  if ("children" in node) {
    for (const child of node.children) {
      resetConstraintsRecursively(child);
    }
  }
}

// Creates a string key from variant properties, used for positioning and comparison.
function variantKey(properties: Record<string, string>, keys: string[]): string {
  return keys.map((k) => properties[k] ?? "").join("|");
}

// Sorts variant nodes alphabetically for consistent visual and layer ordering.
function sortVariantsByName(variants: Variant[]): void {
  variants.sort((a, b) => a.node.name.localeCompare(b.node.name));
}

// Sorts ComponentSet nodes alphabetically before laying them out.
function sortComponentSetsByNameAsc(sets: ComponentSetNode[]): ComponentSetNode[] {
  return sets.slice().sort((a, b) => a.name.localeCompare(b.name));
}

/** ========== [ TYPES ] ========== **/
type Variant = {
  node: ComponentNode;
  properties: Record<string, string>;
};

type VariantInfo = {
  propertyKeys: string[];
  propertyValues: Record<string, Set<string>>;
  variants: Variant[];
};

/** ========== [ ANALYSIS ] ========== **/
// Reads all variant definitions, ensures validity, uniqueness, and returns structure for layout.
function analyzeVariantProperties(componentSet: ComponentSetNode): VariantInfo | null {
  const propertyKeysSet = new Set<string>();
  const propertyValues: Record<string, Set<string>> = {};
  const variants: Variant[] = [];

  for (const child of componentSet.children) {
    if (child.type !== 'COMPONENT') continue;

    let properties: Record<string, string>;
    try {
      properties = child.variantProperties ?? {};
    } catch (e) {
      log('Failed to read variant properties. It may be broken or contain conflicting values.', 'error');
      figma.closePlugin();
      return null;
    }
    variants.push({ node: child, properties });

    Object.entries(properties).forEach(([key, value]) => {
      propertyKeysSet.add(key);
      if (!propertyValues[key]) propertyValues[key] = new Set();
      propertyValues[key].add(value);
    });
  }

  if (variants.length === 0) {
    log('No variants found in the ComponentSet. Please check its structure.', 'error');
    figma.closePlugin();
    return null;
  }

  if (propertyKeysSet.size === 0) {
    log('No variant properties detected in the ComponentSet. Please verify its structure.', 'error');
    figma.closePlugin();
    return null;
  }

  const seenKeys = new Set<string>();
  for (const variant of variants) {
    const key = variantKey(variant.properties, Array.from(propertyKeysSet));
    if (seenKeys.has(key)) {
      log(`Some variants have duplicate property values: ${key}.

Figma will also highlight the conflict. Please ensure each variant has unique property values.`, 'error');
      figma.closePlugin();
      return null;
    }
    seenKeys.add(key);
  }

  sortVariantsByName(variants);

  return {
    propertyKeys: Array.from(propertyKeysSet),
    propertyValues,
    variants,
  };
}

/** ========== [ LAYOUT LOGIC ] ========== **/
// Builds the X/Y position grid for variants based on Size, Style, Color, and Set.
function planLayoutWithSizeOnXColorOnY(
  variantInfo: VariantInfo,
  step = CONFIG.step,
  setProp = CONFIG.props.set,
  styleProp = CONFIG.props.style,
  colorProp = CONFIG.props.color,
  sizeProp = CONFIG.props.size
): Map<string, { x: number; y: number }> {
  const setGroups = new Map<string, Variant[]>();

  for (const variant of variantInfo.variants) {
    const setValue = variant.properties[setProp] ?? "default";
    if (!setGroups.has(setValue)) setGroups.set(setValue, []);
    setGroups.get(setValue)!.push(variant);
  }

  const positionMap = new Map<string, { x: number; y: number }>();
  let baseX = 0;

  const globalStyleKeys = Array.from(variantInfo.propertyValues[styleProp] ?? []).sort();
  const globalColorKeys = Array.from(variantInfo.propertyValues[colorProp] ?? []).sort();
  const globalSizeKeys = Array.from(variantInfo.propertyValues[sizeProp] ?? []).sort((a, b) => Number(a) - Number(b));

  const styleIndexMap = new Map(globalStyleKeys.map((k, i) => [k, i]));
  const colorIndexMap = new Map(globalColorKeys.map((k, i) => [k, i]));
  const sizeIndexMap = new Map(globalSizeKeys.map((k, i) => [k, i]));

  const blockWidth = globalSizeKeys.length * step;

  const sortedSetKeys = Array.from(setGroups.keys()).sort();
  for (const setKey of sortedSetKeys) {
    const variants = setGroups.get(setKey)!;
    for (const variant of variants) {
      const key = variantKey(variant.properties, variantInfo.propertyKeys);
      const styleIdx = styleIndexMap.get(variant.properties[styleProp] ?? "") ?? 0;
      const colorIdx = colorIndexMap.get(variant.properties[colorProp] ?? "") ?? 0;
      const sizeIdx = sizeIndexMap.get(variant.properties[sizeProp] ?? "") ?? 0;

      const x = baseX + sizeIdx * step + CONFIG.padding;
      const y = styleIdx * (globalColorKeys.length * step) + colorIdx * step + CONFIG.padding;

      positionMap.set(key, { x, y });
    }

    baseX += blockWidth + step;
  }

  return positionMap;
}

/** ========== [ TRANSFORMATIONS ] ========== **/
// Moves variants to calculated positions, reorders them in layers, and resizes the ComponentSet to fit content.
function transformLayout(
  variantInfo: VariantInfo,
  positionMap: Map<string, { x: number; y: number }>,
  componentSet: ComponentSetNode
): void {
  for (const variant of variantInfo.variants) {
    resetConstraintsRecursively(variant.node);
    variant.node.x = 0;
    variant.node.y = 0;
  }

  for (const variant of variantInfo.variants) {
    const key = variantKey(variant.properties, variantInfo.propertyKeys);
    const pos = positionMap.get(key);
    if (!pos) continue;
    variant.node.x = pos.x;
    variant.node.y = pos.y;
  }

  const children = componentSet.children.slice();
  children.sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
  for (let i = 0; i < children.length; i++) {
    componentSet.insertChild(i, children[i]);
  }

  if (componentSet.children.length === 0) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const child of componentSet.children) {
    minX = Math.min(minX, child.x);
    minY = Math.min(minY, child.y);
    maxX = Math.max(maxX, child.x + child.width);
    maxY = Math.max(maxY, child.y + child.height);
  }
  for (const child of componentSet.children) {
    child.x -= (minX - CONFIG.padding);
    child.y -= (minY - CONFIG.padding);
  }
  const newWidth = maxX - minX + CONFIG.padding * 2;
  const newHeight = maxY - minY + CONFIG.padding * 2;
  componentSet.resize(newWidth, newHeight);
}

/** ========== [ MAIN ] ========== **/
// Main logic: detects selection or page-wide ComponentSets, arranges them, and zooms to result.
function run(): void {
  let selected = figma.currentPage.selection.filter((n) => n.type === 'COMPONENT_SET') as ComponentSetNode[];
  if (selected.length === 0) {
    selected = figma.currentPage.findAll((n) => n.type === 'COMPONENT_SET') as ComponentSetNode[];
  }

  if (selected.length === 0) {
    log('No ComponentSets found to process.', 'error');
    figma.closePlugin();
    return;
  }

  const sorted = sortComponentSetsByNameAsc(selected);
  let successCount = 0;
  let offsetX = 0;

  for (const componentSet of sorted) {
    log(`Processing ComponentSet: ${componentSet.name}`);
    const variantInfo = analyzeVariantProperties(componentSet);
    if (!variantInfo) continue;

    const positionMap = planLayoutWithSizeOnXColorOnY(variantInfo);
    log(`Layout grid created with ${positionMap.size} positions.`);

    variantInfo.variants.forEach((v) => {
      const key = variantKey(v.properties, variantInfo.propertyKeys);
      const pos = positionMap.get(key);
      log(`Variant: ${key} → x: ${pos?.x}, y: ${pos?.y}`);
    });

    transformLayout(variantInfo, positionMap, componentSet);

    componentSet.x = offsetX;
    componentSet.y = 0;
    offsetX += componentSet.width + CONFIG.gapBetweenSets;

    log(`📐 Final component size: ${componentSet.width} × ${componentSet.height}`);
    successCount++;
  }

  const parent = sorted[0].parent;
  if (parent) {
    for (let i = sorted.length - 1; i >= 0; i--) {
      parent.insertChild(0, sorted[i]);
    }
  }

  figma.viewport.scrollAndZoomIntoView(sorted);
  figma.notify(`✅ Done! ${successCount} ComponentSet${successCount === 1 ? '' : 's'} updated.`);
  figma.closePlugin();
}

run();
