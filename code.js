"use strict";
/** =============================================
 *  HolySheet — ComponentSet Auto‑Layout Plugin
 *  Modular (IIFE) refactor: Logger, Inspector, Layout
 *  ============================================= */
/** ========== [ CONFIG ] ========== **/
const CONFIG = {
    padding: 20,
    step: 52,
    gapBetweenSets: 20,
    props: { set: "Set", style: "Style", color: "Color", size: "Size" }
};
/** ========== [ LOGGER ] ========== **/
const Logger = (() => {
    const priority = { debug: 0, info: 1, error: 2 };
    let current = "info";
    function setLevel(l) { current = l; }
    function log(msg, l = "info") {
        if (priority[l] < priority[current])
            return;
        if (l === "error") {
            figma.notify(msg, { error: true });
            console.error("[HolySheet]", msg);
        }
        else {
            console.log("[HolySheet]", msg);
        }
    }
    return { log, setLevel };
})();
/** ========== [ INSPECTOR ] ========== **/
const Inspector = (() => {
    function variantKey(props, keys) {
        return keys.map(k => { var _a; return (_a = props[k]) !== null && _a !== void 0 ? _a : ""; }).join("|");
    }
    function sortByName(items) {
        items.sort((a, b) => a.node.name.localeCompare(b.node.name));
    }
    function readVariantProperties(set) {
        var _a;
        const keySet = new Set();
        const valMap = {};
        const variants = [];
        for (const child of set.children) {
            if (child.type !== "COMPONENT")
                continue;
            const props = (_a = child.variantProperties) !== null && _a !== void 0 ? _a : {};
            variants.push({ node: child, properties: props });
            for (const [k, v] of Object.entries(props)) {
                keySet.add(k);
                if (!valMap[k])
                    valMap[k] = new Set();
                valMap[k].add(v);
            }
        }
        if (!variants.length) {
            Logger.log("No variants in ComponentSet.", "error");
            figma.closePlugin();
            return null;
        }
        sortByName(variants);
        return { propertyKeys: Array.from(keySet).sort(), propertyValues: valMap, variants };
    }
    function validate(info) {
        const seen = new Set();
        for (const v of info.variants) {
            const key = variantKey(v.properties, info.propertyKeys);
            if (seen.has(key)) {
                Logger.log(`Duplicate variant properties: ${key}`, "error");
                figma.closePlugin();
                return false;
            }
            seen.add(key);
        }
        return true;
    }
    function resetConstraints(node) {
        if ("constraints" in node)
            node.constraints = { horizontal: "MIN", vertical: "MIN" };
        if ("children" in node)
            node.children.forEach(resetConstraints);
    }
    return { variantKey, readVariantProperties, validate, resetConstraints };
})();
/** ========== [ LAYOUT ] ========== **/
const LayoutService = (() => {
    function sortColorKeys(keys) {
        return keys.sort((a, b) => {
            const p = (c) => { var _a, _b; return (((_a = c[0]) === null || _a === void 0 ? void 0 : _a.toLowerCase()) === "n" ? 0 : ((_b = c[0]) === null || _b === void 0 ? void 0 : _b.toLowerCase()) === "s" ? 1 : 2); };
            const pa = p(a), pb = p(b);
            return pa === pb ? a.localeCompare(b) : pa - pb;
        });
    }
    function plan(info) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
        const { step, padding, props } = CONFIG;
        const { set: setProp, style: styleProp, color: colorProp, size: sizeProp } = props;
        // group variants by Set
        const setGroups = new Map();
        for (const v of info.variants) {
            const key = (_a = v.properties[setProp]) !== null && _a !== void 0 ? _a : "default";
            let arr = setGroups.get(key);
            if (!arr) {
                arr = [];
                setGroups.set(key, arr);
            }
            arr.push(v);
        }
        const styles = Array.from((_b = info.propertyValues[styleProp]) !== null && _b !== void 0 ? _b : []).sort().reverse();
        const colors = sortColorKeys(Array.from((_c = info.propertyValues[colorProp]) !== null && _c !== void 0 ? _c : []));
        const sizes = Array.from((_d = info.propertyValues[sizeProp]) !== null && _d !== void 0 ? _d : []).sort((a, b) => Number(a) - Number(b));
        const idx = (arr) => new Map(arr.map((v, i) => [v, i]));
        const iStyle = idx(styles), iColor = idx(colors), iSize = idx(sizes);
        const pos = new Map();
        let baseX = 0;
        const blockW = sizes.length * step;
        for (const setKey of Array.from(setGroups.keys()).sort().reverse()) {
            for (const v of setGroups.get(setKey)) {
                const sx = (_f = iSize.get((_e = v.properties[sizeProp]) !== null && _e !== void 0 ? _e : "")) !== null && _f !== void 0 ? _f : 0;
                const sy = (_h = iStyle.get((_g = v.properties[styleProp]) !== null && _g !== void 0 ? _g : "")) !== null && _h !== void 0 ? _h : 0;
                const cy = (_k = iColor.get((_j = v.properties[colorProp]) !== null && _j !== void 0 ? _j : "")) !== null && _k !== void 0 ? _k : 0;
                const x = baseX + sx * step + padding;
                const cellTop = sy * (colors.length * step) + cy * step + padding;
                const y = cellTop + step / 2 - v.node.height / 2;
                pos.set(Inspector.variantKey(v.properties, info.propertyKeys), { x, y });
            }
            baseX += blockW + step;
        }
        return pos;
    }
    function apply(info, map, setNode) {
        info.variants.forEach(v => { Inspector.resetConstraints(v.node); v.node.x = v.node.y = 0; });
        info.variants.forEach(v => {
            const p = map.get(Inspector.variantKey(v.properties, info.propertyKeys));
            if (p) {
                v.node.x = p.x;
                v.node.y = p.y;
            }
        });
        const ordered = setNode.children.slice().sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
        ordered.forEach((n, i) => setNode.insertChild(i, n));
        if (!setNode.children.length)
            return;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        setNode.children.forEach(c => {
            minX = Math.min(minX, c.x);
            minY = Math.min(minY, c.y);
            maxX = Math.max(maxX, c.x + c.width);
            maxY = Math.max(maxY, c.y + c.height);
        });
        setNode.children.forEach(c => { c.x -= (minX - CONFIG.padding); c.y -= (minY - CONFIG.padding); });
        setNode.resize(maxX - minX + CONFIG.padding * 2, maxY - minY + CONFIG.padding * 2);
    }
    return { plan, apply };
})();
/** ========== [ MAIN ] ========== **/
(function run() {
    var _a;
    const allSets = figma.currentPage.findAll(n => n.type === "COMPONENT_SET");
    if (!allSets.length) {
        Logger.log("No ComponentSets on page.", "error");
        figma.closePlugin();
        return;
    }
    const selected = figma.currentPage.selection.filter(n => n.type === "COMPONENT_SET");
    const auto = !selected.length;
    const sets = [...(auto ? allSets : selected)].sort((a, b) => a.name.localeCompare(b.name));
    let processed = 0, offsetX = 0;
    for (const setNode of sets) {
        Logger.log(`Processing: ${setNode.name}`);
        const info = Inspector.readVariantProperties(setNode);
        if (!info || !Inspector.validate(info))
            continue;
        const positions = LayoutService.plan(info);
        LayoutService.apply(info, positions, setNode);
        if (auto) {
            setNode.x = offsetX;
            setNode.y = 0;
            offsetX += setNode.width + CONFIG.gapBetweenSets;
        }
        processed++;
        Logger.log(`📐 Size: ${setNode.width}×${setNode.height}`);
    }
    if (auto && ((_a = sets[0]) === null || _a === void 0 ? void 0 : _a.parent)) {
        const parent = sets[0].parent;
        for (let i = sets.length - 1; i >= 0; i--)
            parent.insertChild(0, sets[i]);
    }
    figma.viewport.scrollAndZoomIntoView(sets);
    figma.notify(`✅ Done! ${processed} ComponentSet${processed === 1 ? "" : "s"} updated.`);
    figma.closePlugin();
})();
