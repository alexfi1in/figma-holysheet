/**
 * HolySheet — Figma-плагин для интеллектуального переупорядочивания и размещения вариантов внутри выбранного ComponentSet.
 *
 * Архитектурные принципы:
 * — Модульность: каждая функция выполняет отдельную задачу.
 * — Безопасность: только работа внутри выбранного узла, без внешних изменений.
 * — Расширяемость: архитектура упрощает добавление новых сценариев.
 * — Лаконичный UX: ошибки и статус — только в консоль/уведомление.
 */

const PADDING = 20;

function log(message: string, type: 'info' | 'error' = 'info'): void {
  if (type === 'error') {
    figma.notify(message, { error: true });
    console.error('[HolySheet]', message);
  } else {
    console.log('[HolySheet]', message);
  }
}

function validateSelection(): ComponentSetNode | null {
  const selection = figma.currentPage.selection;
  if (selection.length !== 1) {
    log('Выделите ровно один набор вариантов (ComponentSet).', 'error');
    return null;
  }
  const node = selection[0];
  if (node.type !== 'COMPONENT_SET') {
    log('Выделенный объект не является набором вариантов (ComponentSet).', 'error');
    return null;
  }
  return node as ComponentSetNode;
}

type Variant = {
  node: ComponentNode;
  properties: Record<string, string>;
};

type VariantInfo = {
  propertyKeys: string[];
  propertyValues: Record<string, Set<string>>;
  variants: Variant[];
};

function analyzeVariantProperties(componentSet: ComponentSetNode): VariantInfo | null {
  const propertyKeysSet = new Set<string>();
  const propertyValues: Record<string, Set<string>> = {};
  const variants: Variant[] = [];

  for (const child of componentSet.children) {
    if (child.type !== 'COMPONENT') continue;

    const properties = child.variantProperties ?? {};
    variants.push({ node: child, properties });

    Object.entries(properties).forEach(([key, value]) => {
      propertyKeysSet.add(key);
      if (!propertyValues[key]) propertyValues[key] = new Set();
      propertyValues[key].add(value);
    });
  }

  if (variants.length === 0) {
    log('В наборе вариантов не найдено ни одного варианта. Проверьте структуру ComponentSet.', 'error');
    figma.closePlugin();
    return null;
  }

  if (propertyKeysSet.size === 0) {
    log('Не обнаружены variant-свойства в ComponentSet. Проверьте правильность структуры.', 'error');
    figma.closePlugin();
    return null;
  }

  return {
    propertyKeys: Array.from(propertyKeysSet),
    propertyValues,
    variants,
  };
}

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

function applyLayout(
  variantInfo: VariantInfo,
  positionMap: Map<string, { x: number; y: number }>
): void {
  // Сброс всех координат до раскладки — чтобы избежать накопленного смещения при повторных запусках
  for (const variant of variantInfo.variants) {
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
}

function sortLayersByPosition(componentSet: ComponentSetNode): void {
  const children = componentSet.children.slice();

  children.sort((a, b) => {
    if (a.y === b.y) return a.x - b.x;
    return a.y - b.y;
  });

  for (let i = 0; i < children.length; i++) {
    componentSet.insertChild(i, children[i]);
  }
}

function resizeComponentToFitChildren(node: ComponentSetNode | FrameNode) {
  if (node.children.length === 0) return;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const child of node.children) {
    minX = Math.min(minX, child.x);
    minY = Math.min(minY, child.y);
    maxX = Math.max(maxX, child.x + child.width);
    maxY = Math.max(maxY, child.y + child.height);
  }

  // Смещаем всех так, чтобы minX/minY оказались на PADDING
  for (const child of node.children) {
    child.x -= (minX - PADDING);
    child.y -= (minY - PADDING);
  }

  const newWidth = maxX - minX + PADDING * 2;
  const newHeight = maxY - minY + PADDING * 2;

  node.resize(newWidth, newHeight);
}



function run(): void {
  const componentSet = validateSelection();
  if (!componentSet) {
    figma.closePlugin();
    return;
  }

  log("Выделен корректный ComponentSet. Анализируем variant-свойства...");

  const variantInfo = analyzeVariantProperties(componentSet);
  if (!variantInfo) {
    return;
  }

  const positionMap = planLayoutWithSizeOnXColorOnY(variantInfo);
  log(`Построена сетка с ${positionMap.size} позициями.`);

  variantInfo.variants.forEach((v) => {
    const key = variantInfo.propertyKeys.map((k) => v.properties[k] ?? "").join("|");
    const pos = positionMap.get(key);
    log(`Вариант: ${key} → x: ${pos?.x}, y: ${pos?.y}`);
  });

  applyLayout(variantInfo, positionMap);
  sortLayersByPosition(componentSet);
  resizeComponentToFitChildren(componentSet);
  log(`📐 Итоговый размер компонента: ${componentSet.width} × ${componentSet.height}`);

  figma.notify("✅ Готово!");
  figma.closePlugin();
}

run();
