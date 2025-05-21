"use strict";
/** ========== [ CONFIG ] ========== **/
const CONFIG = {
    padding: 20,
    step: 52,
    gapBetweenSets: 20,
    props: {
        set: "Set",
        style: "Style",
        color: "Color",
        size: "Size"
    }
};
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
function variantKey(properties, keys) {
    return keys.map((k) => { var _a; return (_a = properties[k]) !== null && _a !== void 0 ? _a : ""; }).join("|");
}
function sortVariantsByName(variants) {
    variants.sort((a, b) => a.node.name.localeCompare(b.node.name));
}
function sortComponentSetsByNameAsc(sets) {
    return sets.slice().sort((a, b) => a.name.localeCompare(b.name));
}
function sortColorKeysWithLetterPriority(keys) {
    return keys.sort((a, b) => {
        const getPriority = (key) => {
            var _a;
            const first = (_a = key[0]) === null || _a === void 0 ? void 0 : _a.toLowerCase();
            if (first === 'n')
                return 0;
            if (first === 's')
                return 1;
            return 2;
        };
        const pa = getPriority(a);
        const pb = getPriority(b);
        return pa === pb ? a.localeCompare(b) : pa - pb;
    });
}
/** ========== [ ANALYSIS ] ========== **/
function readVariantProperties(componentSet) {
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
    sortVariantsByName(variants);
    return {
        propertyKeys: Array.from(propertyKeysSet),
        propertyValues,
        variants,
    };
}
function validateVariantUniqueness(variantInfo) {
    const seenKeys = new Set();
    for (const variant of variantInfo.variants) {
        const key = variantKey(variant.properties, variantInfo.propertyKeys);
        if (seenKeys.has(key)) {
            log(`Some variants have duplicate property values: ${key}.

Figma will also highlight the conflict. Please ensure each variant has unique property values.`, 'error');
            figma.closePlugin();
            return false;
        }
        seenKeys.add(key);
    }
    return true;
}
/**
 * Calculates the position of each variant in X and Y coordinates,
 * where X is size and Y is style × color.
 */
function planLayoutWithSizeOnXColorOnY(variantInfo, step = CONFIG.step, setProp = CONFIG.props.set, styleProp = CONFIG.props.style, colorProp = CONFIG.props.color, sizeProp = CONFIG.props.size) {
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
    const globalStyleKeys = Array.from((_b = variantInfo.propertyValues[styleProp]) !== null && _b !== void 0 ? _b : []).sort().reverse();
    const globalColorKeys = sortColorKeysWithLetterPriority(Array.from((_c = variantInfo.propertyValues[colorProp]) !== null && _c !== void 0 ? _c : []));
    const globalSizeKeys = Array.from((_d = variantInfo.propertyValues[sizeProp]) !== null && _d !== void 0 ? _d : []).sort((a, b) => Number(a) - Number(b));
    log(`[Sort] Style: ${globalStyleKeys.join(', ')}`);
    log(`[Sort] Color: ${globalColorKeys.join(', ')}`);
    log(`[Sort] Size: ${globalSizeKeys.join(', ')}`);
    const styleIndexMap = new Map(globalStyleKeys.map((k, i) => [k, i]));
    const colorIndexMap = new Map(globalColorKeys.map((k, i) => [k, i]));
    const sizeIndexMap = new Map(globalSizeKeys.map((k, i) => [k, i]));
    const blockWidth = globalSizeKeys.length * step;
    const sortedSetKeys = Array.from(setGroups.keys()).sort().reverse();
    for (const setKey of sortedSetKeys) {
        const variants = setGroups.get(setKey);
        for (const variant of variants) {
            const key = variantKey(variant.properties, variantInfo.propertyKeys);
            const styleIdx = (_f = styleIndexMap.get((_e = variant.properties[styleProp]) !== null && _e !== void 0 ? _e : "")) !== null && _f !== void 0 ? _f : 0;
            const colorIdx = (_h = colorIndexMap.get((_g = variant.properties[colorProp]) !== null && _g !== void 0 ? _g : "")) !== null && _h !== void 0 ? _h : 0;
            const sizeIdx = (_k = sizeIndexMap.get((_j = variant.properties[sizeProp]) !== null && _j !== void 0 ? _j : "")) !== null && _k !== void 0 ? _k : 0;
            const x = baseX + sizeIdx * step + CONFIG.padding;
            const cellTop = styleIdx * (globalColorKeys.length * step) + colorIdx * step + CONFIG.padding;
            const y = cellTop + step / 2 - variant.node.height / 2;
            positionMap.set(key, { x, y });
        }
        baseX += blockWidth + step;
    }
    return positionMap;
}
/** ========== [ APPLY ] ========== **/
function transformLayout(variantInfo, positionMap, componentSet) {
    for (const variant of variantInfo.variants) {
        resetConstraintsRecursively(variant.node);
        variant.node.x = 0;
        variant.node.y = 0;
    }
    for (const variant of variantInfo.variants) {
        const key = variantKey(variant.properties, variantInfo.propertyKeys);
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
        child.x -= (minX - CONFIG.padding);
        child.y -= (minY - CONFIG.padding);
    }
    const newWidth = maxX - minX + CONFIG.padding * 2;
    const newHeight = maxY - minY + CONFIG.padding * 2;
    componentSet.resize(newWidth, newHeight);
}
/** ========== [ MAIN ] ========== **/
function run() {
    const allComponentSets = figma.currentPage.findAll(n => n.type === 'COMPONENT_SET');
    const selectedSets = figma.currentPage.selection.filter(n => n.type === 'COMPONENT_SET');
    if (allComponentSets.length === 0) {
        log('No ComponentSets found on the page.', 'error');
        figma.closePlugin();
        return;
    }
    const isAutoMode = selectedSets.length === 0;
    const setsToProcess = isAutoMode ? allComponentSets : selectedSets;
    const sorted = sortComponentSetsByNameAsc(setsToProcess);
    let successCount = 0;
    let offsetX = 0;
    for (let i = 0; i < sorted.length; i++) {
        const componentSet = sorted[i];
        log(`Processing ComponentSet: ${componentSet.name}`);
        const variantInfo = readVariantProperties(componentSet);
        if (!variantInfo)
            continue;
        if (!validateVariantUniqueness(variantInfo))
            continue;
        const positionMap = planLayoutWithSizeOnXColorOnY(variantInfo);
        log(`Layout grid created with ${positionMap.size} positions.`);
        variantInfo.variants.forEach((v) => {
            const key = variantKey(v.properties, variantInfo.propertyKeys);
            const pos = positionMap.get(key);
            log(`Variant: ${key} → x: ${pos === null || pos === void 0 ? void 0 : pos.x}, y: ${pos === null || pos === void 0 ? void 0 : pos.y}`);
        });
        transformLayout(variantInfo, positionMap, componentSet);
        if (isAutoMode) {
            componentSet.x = offsetX;
            componentSet.y = 0;
            offsetX += componentSet.width + CONFIG.gapBetweenSets;
        }
        log(`📐 Final component size: ${componentSet.width} × ${componentSet.height}`);
        successCount++;
    }
    if (isAutoMode && sorted[0].parent) {
        const parent = sorted[0].parent;
        for (let i = sorted.length - 1; i >= 0; i--) {
            parent.insertChild(0, sorted[i]);
        }
    }
    figma.viewport.scrollAndZoomIntoView(sorted);
    figma.notify(`✅ Done! ${successCount} ComponentSet${successCount === 1 ? '' : 's'} updated.`);
    figma.closePlugin();
}
run();
