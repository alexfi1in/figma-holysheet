"use strict";
/// <reference types="@figma/plugin-typings" />
/** =============================================
 *  HolySheet — ComponentSet Auto‑Layout Plugin
 *  Modular (IIFE) refactor: Logger, Inspector, Layout
 *  ============================================= */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
/** ========== [ CONFIG ] ========== **/
const CONFIG = {
    padding: 20,
    step: 52,
    gapBetweenBlocks: 52,
    gapBetweenSets: 20,
    props: { set: "Set", style: "Style", color: "Color", size: "Size" }
};
/** ========== [ LOGGER ] ========== **/
const Logger = (() => {
    const priority = { debug: 0, info: 1, error: 2 };
    const current = "info";
    function log(msg, l = "info") {
        if (priority[l] < priority[current])
            return;
        if (l === "error") {
            figma.notify(msg, { error: true, timeout: 5000 });
            console.error("[HolySheet]", msg);
        }
        else {
            console.log("[HolySheet]", msg);
        }
    }
    return { log };
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
        if (!variants.length)
            return null;
        sortByName(variants);
        return { propertyKeys: Array.from(keySet).sort(), propertyValues: valMap, variants };
    }
    function validate(info) {
        const seen = new Set();
        for (const v of info.variants) {
            const key = variantKey(v.properties, info.propertyKeys);
            if (seen.has(key))
                return `Duplicate variant properties: ${key}`;
            seen.add(key);
        }
        return null;
    }
    function resetConstraints(node) {
        if ("constraints" in node)
            node.constraints = { horizontal: "MIN", vertical: "MIN" };
        if ("children" in node)
            node.children.forEach(resetConstraints);
    }
    function hasNonZeroRotation(node) {
        return Math.abs(node.rotation) > 0.001;
    }
    function collectRotationIssuesGrouped(set) {
        const variants = [];
        for (const child of set.children) {
            if (child.type !== "COMPONENT")
                continue;
            if (hasNonZeroRotation(child))
                variants.push(child.name);
        }
        return variants.length ? { set: set.name, variants } : null;
    }
    return { variantKey, readVariantProperties, validate, resetConstraints, collectRotationIssuesGrouped };
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
        const { step, padding, gapBetweenBlocks, props } = CONFIG;
        const { set: setProp, style: styleProp, color: colorProp, size: sizeProp } = props;
        const styles = Array.from((_a = info.propertyValues[styleProp]) !== null && _a !== void 0 ? _a : []).sort().reverse();
        const colors = sortColorKeys(Array.from((_b = info.propertyValues[colorProp]) !== null && _b !== void 0 ? _b : []));
        const sizes = Array.from((_c = info.propertyValues[sizeProp]) !== null && _c !== void 0 ? _c : []).sort((a, b) => Number(a) - Number(b));
        if (!sizes.length || !styles.length || !colors.length)
            return null;
        // group variants by Set
        const setGroups = new Map();
        for (const v of info.variants) {
            const key = (_d = v.properties[setProp]) !== null && _d !== void 0 ? _d : "default";
            let arr = setGroups.get(key);
            if (!arr) {
                arr = [];
                setGroups.set(key, arr);
            }
            arr.push(v);
        }
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
            baseX += blockW + gapBetweenBlocks;
        }
        return pos;
    }
    function apply(info, map, setNode) {
        info.variants.forEach(v => {
            var _a, _b;
            Inspector.resetConstraints(v.node);
            const p = map.get(Inspector.variantKey(v.properties, info.propertyKeys));
            v.node.x = (_a = p === null || p === void 0 ? void 0 : p.x) !== null && _a !== void 0 ? _a : 0;
            v.node.y = (_b = p === null || p === void 0 ? void 0 : p.y) !== null && _b !== void 0 ? _b : 0;
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
        setNode.resizeWithoutConstraints(maxX - minX + CONFIG.padding * 2, maxY - minY + CONFIG.padding * 2);
    }
    return { plan, apply };
})();
/** ========== [ ROTATION REPORT ] ========== **/
function createRotationReport(groupedIssues, anchor) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        yield figma.loadFontAsync({ family: "Inter", style: "Regular" });
        yield figma.loadFontAsync({ family: "Inter", style: "Bold" });
        const text = figma.createText();
        try {
            text.fontName = { family: "Inter", style: "Regular" };
        }
        catch ( /* keep default font if unavailable */_c) { /* keep default font if unavailable */ }
        const title = "Rotation issues detected (please normalize Rotation to 0):";
        const lines = [title, ""];
        const ranges = [{ start: 0, end: title.length, kind: "title" }];
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
            if (gi < groupedIssues.length - 1) {
                lines.push("");
                offset += 1;
            }
        });
        text.characters = lines.join("\n");
        text.textAutoResize = "HEIGHT";
        text.fontSize = 12;
        for (const r of ranges) {
            if (r.kind === "title") {
                text.setRangeFontName(r.start, r.end, { family: "Inter", style: "Bold" });
                text.setRangeFontSize(r.start, r.end, 12);
                text.setRangeFills(r.start, r.end, [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }]);
            }
            else if (r.kind === "set") {
                text.setRangeFontName(r.start, r.end, { family: "Inter", style: "Bold" });
                text.setRangeFontSize(r.start, r.end, 12);
            }
            else {
                text.setRangeFontSize(r.start, r.end, 12);
            }
        }
        text.x = (_a = anchor === null || anchor === void 0 ? void 0 : anchor.x) !== null && _a !== void 0 ? _a : 0;
        text.y = ((_b = anchor === null || anchor === void 0 ? void 0 : anchor.y) !== null && _b !== void 0 ? _b : 0) - 40;
        figma.currentPage.appendChild(text);
        figma.viewport.scrollAndZoomIntoView([text]);
    });
}
/** ========== [ MAIN ] ========== **/
(function run() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        yield figma.currentPage.loadAsync();
        const allSets = figma.currentPage.findAllWithCriteria({ types: ["COMPONENT_SET"] });
        if (!allSets.length) {
            Logger.log("No ComponentSets on page.", "error");
            figma.closePlugin();
            return;
        }
        const selected = figma.currentPage.selection.filter(n => n.type === "COMPONENT_SET");
        const auto = !selected.length;
        const sets = [...(auto ? allSets : selected)].sort((a, b) => a.name.localeCompare(b.name));
        const groupedIssues = [];
        for (const setNode of sets) {
            const group = Inspector.collectRotationIssuesGrouped(setNode);
            if (group)
                groupedIssues.push(group);
        }
        if (groupedIssues.length) {
            Logger.log("Found nodes with Rotation ≠ 0. See generated report.", "error");
            try {
                yield createRotationReport(groupedIssues, sets[0]);
            }
            catch ( /* toast already shown */_b) { /* toast already shown */ }
            figma.closePlugin();
            return;
        }
        let processed = 0, offsetX = 0;
        for (const setNode of sets) {
            Logger.log(`Processing: ${setNode.name}`);
            const info = Inspector.readVariantProperties(setNode);
            if (!info) {
                Logger.log(`No variants in "${setNode.name}".`, "error");
                continue;
            }
            const validationError = Inspector.validate(info);
            if (validationError) {
                Logger.log(validationError, "error");
                continue;
            }
            const positions = LayoutService.plan(info);
            if (!positions) {
                Logger.log(`Missing required variant properties (Style/Color/Size) in "${setNode.name}".`, "error");
                continue;
            }
            LayoutService.apply(info, positions, setNode);
            if (auto) {
                setNode.x = offsetX;
                setNode.y = 0;
                offsetX += setNode.width + CONFIG.gapBetweenSets;
            }
            processed++;
            Logger.log(`📐 Size: ${setNode.width}×${setNode.height}`);
        }
        if (!processed) {
            Logger.log("No ComponentSets were updated. Check the errors above.", "error");
            figma.closePlugin();
            return;
        }
        if (auto && ((_a = sets[0]) === null || _a === void 0 ? void 0 : _a.parent)) {
            const parent = sets[0].parent;
            for (let i = sets.length - 1; i >= 0; i--)
                parent.insertChild(0, sets[i]);
        }
        figma.viewport.scrollAndZoomIntoView(sets);
        figma.notify(`✅ Done! ${processed} ComponentSet${processed === 1 ? "" : "s"} updated.`);
        figma.closePlugin();
    });
})();
