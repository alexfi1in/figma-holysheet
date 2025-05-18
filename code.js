"use strict";
/** ========== [ CONSTANTS ] ========== **/
const PADDING = 20;
/** ========== [ UTILS ] ========== **/
function log(message, type = 'info') {
    if (type === 'error') {
        figma.notify(message, { error: true });
        console.error('[HolySheet]', message);
    }
    else {
        console.log('[HolySheet]', message);
    }
}
function resetConstraintsRecursively(node) {
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
function validateSelection() {
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
    return node;
}
/** ========== [ ANALYSIS ] ========== **/
function analyzeVariantProperties(componentSet) {
    var _a;
    const propertyKeysSet = new Set();
    const propertyValues = {};
    const variants = [];
    for (const child of componentSet.children) {
        if (child.type !== 'COMPONENT')
            continue;
        let properties;
        try {
            properties = (_a = child.variantProperties) !== null && _a !== void 0 ? _a : {};
        }
        catch (e) {
            log('Failed to read variant properties. It may be broken or contain conflicting values.', 'error');
            figma.closePlugin();
            return null;
        }
        variants.push({ node: child, properties });
        Object.entries(properties).forEach(([key, value]) => {
            propertyKeysSet.add(key);
            if (!propertyValues[key])
                propertyValues[key] = new Set();
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
    const seenKeys = new Set();
    for (const variant of variants) {
        const key = Array.from(propertyKeysSet).map(k => { var _a; return (_a = variant.properties[k]) !== null && _a !== void 0 ? _a : ""; }).join("|");
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
function planLayoutWithSizeOnXColorOnY(variantInfo, step = 48, setProp = "Set", styleProp = "Style", colorProp = "Color", sizeProp = "Size") {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    const setGroups = new Map();
    for (const variant of variantInfo.variants) {
        const setValue = (_a = variant.properties[setProp]) !== null && _a !== void 0 ? _a : "default";
        if (!setGroups.has(setValue))
            setGroups.set(setValue, []);
        setGroups.get(setValue).push(variant);
    }
    const positionMap = new Map();
    let baseX = 0;
    const globalStyleKeys = Array.from((_b = variantInfo.propertyValues[styleProp]) !== null && _b !== void 0 ? _b : []).sort();
    const globalColorKeys = Array.from((_c = variantInfo.propertyValues[colorProp]) !== null && _c !== void 0 ? _c : []).sort();
    const globalSizeKeys = Array.from((_d = variantInfo.propertyValues[sizeProp]) !== null && _d !== void 0 ? _d : []).sort((a, b) => Number(a) - Number(b));
    const styleIndexMap = new Map(globalStyleKeys.map((k, i) => [k, i]));
    const colorIndexMap = new Map(globalColorKeys.map((k, i) => [k, i]));
    const sizeIndexMap = new Map(globalSizeKeys.map((k, i) => [k, i]));
    const blockWidth = globalSizeKeys.length * step;
    const sortedSetKeys = Array.from(setGroups.keys()).sort();
    for (const setKey of sortedSetKeys) {
        const variants = setGroups.get(setKey);
        for (const variant of variants) {
            const key = variantInfo.propertyKeys.map(k => { var _a; return (_a = variant.properties[k]) !== null && _a !== void 0 ? _a : ""; }).join("|");
            const styleIdx = (_f = styleIndexMap.get((_e = variant.properties[styleProp]) !== null && _e !== void 0 ? _e : "")) !== null && _f !== void 0 ? _f : 0;
            const colorIdx = (_h = colorIndexMap.get((_g = variant.properties[colorProp]) !== null && _g !== void 0 ? _g : "")) !== null && _h !== void 0 ? _h : 0;
            const sizeIdx = (_k = sizeIndexMap.get((_j = variant.properties[sizeProp]) !== null && _j !== void 0 ? _j : "")) !== null && _k !== void 0 ? _k : 0;
            const x = baseX + sizeIdx * step + PADDING;
            const y = styleIdx * (globalColorKeys.length * step) + colorIdx * step + PADDING;
            positionMap.set(key, { x, y });
        }
        baseX += blockWidth + step;
    }
    return positionMap;
}
/** ========== [ TRANSFORMATIONS ] ========== **/
function transformLayout(variantInfo, positionMap, componentSet) {
    for (const variant of variantInfo.variants) {
        resetConstraintsRecursively(variant.node);
        variant.node.x = 0;
        variant.node.y = 0;
    }
    for (const variant of variantInfo.variants) {
        const key = variantInfo.propertyKeys
            .map((k) => { var _a; return (_a = variant.properties[k]) !== null && _a !== void 0 ? _a : ""; })
            .join("|");
        const pos = positionMap.get(key);
        if (!pos)
            continue;
        variant.node.x = pos.x;
        variant.node.y = pos.y;
    }
    const children = componentSet.children.slice();
    children.sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
    for (let i = 0; i < children.length; i++) {
        componentSet.insertChild(i, children[i]);
    }
    if (componentSet.children.length === 0)
        return;
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
function run() {
    const componentSet = validateSelection();
    if (!componentSet) {
        figma.closePlugin();
        return;
    }
    log("Valid ComponentSet selected. Analyzing variant properties.....");
    const variantInfo = analyzeVariantProperties(componentSet);
    if (!variantInfo)
        return;
    const positionMap = planLayoutWithSizeOnXColorOnY(variantInfo);
    log(`Layout grid created with ${positionMap.size} positions.`);
    variantInfo.variants.forEach((v) => {
        const key = variantInfo.propertyKeys.map((k) => { var _a; return (_a = v.properties[k]) !== null && _a !== void 0 ? _a : ""; }).join("|");
        const pos = positionMap.get(key);
        log(`Variant: ${key} → x: ${pos === null || pos === void 0 ? void 0 : pos.x}, y: ${pos === null || pos === void 0 ? void 0 : pos.y}`);
    });
    transformLayout(variantInfo, positionMap, componentSet);
    log(`📐 Final component size: ${componentSet.width} × ${componentSet.height}`);
    figma.notify("✅ Done!");
    figma.closePlugin();
}
run();
