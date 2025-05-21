"use strict";
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
    padding: 20, // inner padding around grid
    step: 52, // cell size (width/height)
    gapBetweenSets: 20, // gap between Set blocks on X
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
        node.constraints = { horizontal: "MIN", vertical: "MIN" };
    }
    if ("children" in node) {
        for (const child of node.children)
            resetConstraintsRecursively(child);
    }
}
function variantKey(properties, keys) {
    return keys.map(k => { var _a; return (_a = properties[k]) !== null && _a !== void 0 ? _a : ""; }).join("|");
}
function sortVariantsByName(variants) {
    variants.sort((a, b) => a.node.name.localeCompare(b.node.name));
}
function sortComponentSetsByNameAsc(sets) {
    return sets.slice().sort((a, b) => a.name.localeCompare(b.name));
}
function sortColorKeysWithLetterPriority(keys) {
    return keys.sort((a, b) => {
        const priority = (k) => {
            var _a;
            const first = (_a = k[0]) === null || _a === void 0 ? void 0 : _a.toLowerCase();
            if (first === 'n')
                return 0; // neutrals first
            if (first === 's')
                return 1; // semantic second
            return 2; // others
        };
        const pa = priority(a);
        const pb = priority(b);
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
        catch (_b) {
            log('Failed to read variant properties. They may be broken or conflicting.', 'error');
            figma.closePlugin();
            return null;
        }
        variants.push({ node: child, properties });
        for (const [key, value] of Object.entries(properties)) {
            propertyKeysSet.add(key);
            if (!propertyValues[key])
                propertyValues[key] = new Set();
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
function validateVariantUniqueness(variantInfo) {
    const seen = new Set();
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
function planLayoutWithSizeOnXColorOnY(variantInfo, step = CONFIG.step, setProp = CONFIG.props.set, styleProp = CONFIG.props.style, colorProp = CONFIG.props.color, sizeProp = CONFIG.props.size) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    // group by Set
    const setGroups = new Map();
    for (const variant of variantInfo.variants) {
        const setVal = (_a = variant.properties[setProp]) !== null && _a !== void 0 ? _a : 'default';
        if (!setGroups.has(setVal))
            setGroups.set(setVal, []);
        setGroups.get(setVal).push(variant);
    }
    // global ordered keys
    const styles = Array.from((_b = variantInfo.propertyValues[styleProp]) !== null && _b !== void 0 ? _b : []).sort().reverse();
    const colors = sortColorKeysWithLetterPriority(Array.from((_c = variantInfo.propertyValues[colorProp]) !== null && _c !== void 0 ? _c : []));
    const sizes = Array.from((_d = variantInfo.propertyValues[sizeProp]) !== null && _d !== void 0 ? _d : []).sort((a, b) => Number(a) - Number(b));
    log(`[Sort] Style: ${styles}`);
    log(`[Sort] Color: ${colors}`);
    log(`[Sort] Size: ${sizes}`);
    const idx = (arr) => new Map(arr.map((k, i) => [k, i]));
    const styleIdx = idx(styles);
    const colorIdx = idx(colors);
    const sizeIdx = idx(sizes);
    const blockWidth = sizes.length * step;
    let baseX = 0;
    const positionMap = new Map();
    const sortedSetKeys = Array.from(setGroups.keys()).sort().reverse();
    for (const setKey of sortedSetKeys) {
        for (const variant of setGroups.get(setKey)) {
            const key = variantKey(variant.properties, variantInfo.propertyKeys);
            const sx = (_f = sizeIdx.get((_e = variant.properties[sizeProp]) !== null && _e !== void 0 ? _e : '')) !== null && _f !== void 0 ? _f : 0;
            const sy = (_h = styleIdx.get((_g = variant.properties[styleProp]) !== null && _g !== void 0 ? _g : '')) !== null && _h !== void 0 ? _h : 0;
            const cy = (_k = colorIdx.get((_j = variant.properties[colorProp]) !== null && _j !== void 0 ? _j : '')) !== null && _k !== void 0 ? _k : 0;
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
function transformLayout(info, posMap, setNode) {
    // zero‑out before repositioning (keeps diff cleaner)
    for (const v of info.variants) {
        resetConstraintsRecursively(v.node);
        v.node.x = v.node.y = 0;
    }
    // apply positions
    for (const v of info.variants) {
        const key = variantKey(v.properties, info.propertyKeys);
        const p = posMap.get(key);
        if (!p)
            continue;
        v.node.x = p.x;
        v.node.y = p.y;
    }
    // re‑order children visually (top‑to‑bottom, left‑to‑right)
    const ordered = setNode.children.slice().sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
    ordered.forEach((n, i) => setNode.insertChild(i, n));
    // resize ComponentSet frame to fit
    if (!setNode.children.length)
        return;
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
function run() {
    var _a;
    const allSets = figma.currentPage.findAll(n => n.type === 'COMPONENT_SET');
    if (!allSets.length) {
        log('No ComponentSets found on the page.', 'error');
        figma.closePlugin();
        return;
    }
    const selectedSets = figma.currentPage.selection.filter(n => n.type === 'COMPONENT_SET');
    const autoMode = !selectedSets.length;
    const sets = sortComponentSetsByNameAsc(autoMode ? allSets : selectedSets);
    let processed = 0;
    let offsetX = 0; // for auto‑mode block arrangement
    for (const setNode of sets) {
        log(`Processing ComponentSet: ${setNode.name}`);
        const variantInfo = readVariantProperties(setNode);
        if (!variantInfo)
            continue;
        if (!validateVariantUniqueness(variantInfo))
            continue;
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
    if (autoMode && ((_a = sets[0]) === null || _a === void 0 ? void 0 : _a.parent)) {
        const parent = sets[0].parent;
        for (let i = sets.length - 1; i >= 0; i--)
            parent.insertChild(0, sets[i]);
    }
    figma.viewport.scrollAndZoomIntoView(sets);
    figma.notify(`✅ Done! ${processed} ComponentSet${processed === 1 ? '' : 's'} updated.`);
    figma.closePlugin();
}
run();
