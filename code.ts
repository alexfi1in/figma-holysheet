/** ========== [ CONSTANTS ] ========== **/
const PADDING = 20;

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

/** ========== [ VALIDATION ] ========== **/
function validateSelection(): ComponentSetNode | null {
  const selection = figma.currentPage.selection;
  if (selection.length !== 1) {
    log('Select exactly one ComponentSet.', 'error');
    return null;
  }
  const node = selection[0];
  if (node.type !== 'COMPONENT_SET') {
    log('Selected object is not a ComponentSet.', 'error');
    return null;
  }
  return node as ComponentSetNode;
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

    // Проверка на дублирующиеся variant-свойства
  const seenKeys = new Set<string>();
  for (const variant of variants) {
    const key = Array.from(propertyKeysSet).map(k => variant.properties[k] ?? "").join("|");
    if (seenKeys.has(key)) {
      log(`Some variants have duplicate property values: ${key}.

Figma will also highlight the conflict. Please ensure each variant has unique property values.`, 'error');
      figma.closePlugin();
      return null;
    }
    seenKeys.add(key);
  }

  return {
    propertyKeys: Array.from(propertyKeysSet),
    propertyValues,
    variants,
  };
}

/** ========== [ LAYOUT LOGIC ] ========== **/
function planLayoutWithSizeOnXColorOnY(
  variantInfo: VariantInfo,
  step = 48,
  setProp = "Set",
  styleProp = "Style",
  colorProp = "Color",
  sizeProp = "Size"
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
      const key = variantInfo.propertyKeys.map(k => variant.properties[k] ?? "").join("|");
      const styleIdx = styleIndexMap.get(variant.properties[styleProp] ?? "") ?? 0;
      const colorIdx = colorIndexMap.get(variant.properties[colorProp] ?? "") ?? 0;
      const sizeIdx = sizeIndexMap.get(variant.properties[sizeProp] ?? "") ?? 0;

      const x = baseX + sizeIdx * step + PADDING;
      const y = styleIdx * (globalColorKeys.length * step) + colorIdx * step + PADDING;

      positionMap.set(key, { x, y });
    }

    baseX += blockWidth + step;
  }

  return positionMap;
}

/** ========== [ TRANSFORMATIONS ] ========== **/
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
    const key = variantInfo.propertyKeys
      .map((k) => variant.properties[k] ?? "")
      .join("|");
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
    child.x -= (minX - PADDING);
    child.y -= (minY - PADDING);
  }
  const newWidth = maxX - minX + PADDING * 2;
  const newHeight = maxY - minY + PADDING * 2;
  componentSet.resize(newWidth, newHeight);
}

/** ========== [ MAIN ] ========== **/
function run(): void {
  const componentSet = validateSelection();
  if (!componentSet) {
    figma.closePlugin();
    return;
  }

  log("Valid ComponentSet selected. Analyzing variant properties.....");

  const variantInfo = analyzeVariantProperties(componentSet);
  if (!variantInfo) return;

  const positionMap = planLayoutWithSizeOnXColorOnY(variantInfo);
  log(`Layout grid created with ${positionMap.size} positions.`);

  variantInfo.variants.forEach((v) => {
    const key = variantInfo.propertyKeys.map((k) => v.properties[k] ?? "").join("|");
    const pos = positionMap.get(key);
    log(`Variant: ${key} → x: ${pos?.x}, y: ${pos?.y}`);
  });

  transformLayout(variantInfo, positionMap, componentSet);
  log(`📐 Final component size: ${componentSet.width} × ${componentSet.height}`);

  figma.notify("✅ Done!");
  figma.closePlugin();
}

run();

