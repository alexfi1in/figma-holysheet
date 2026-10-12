// Runs the built plugin (code.js) against a fake `figma` global and checks how it lays out variants.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const CODE = fs.readFileSync(path.join(__dirname, "..", "code.js"), "utf8");

function component(props) {
  const size = Number(props.Size) || 16;
  return {
    type: "COMPONENT",
    name: Object.entries(props).map(([k, v]) => `${k}=${v}`).join(", "),
    variantProperties: props,
    x: 0, y: 0, width: size, height: size, rotation: 0,
    constraints: { horizontal: "MIN", vertical: "MIN" },
    children: [],
  };
}

function componentSet(name, variants) {
  const set = {
    type: "COMPONENT_SET", name, x: 0, y: 0, width: 0, height: 0, children: variants,
    insertChild(i, node) {
      const k = this.children.indexOf(node);
      if (k >= 0) this.children.splice(k, 1);
      this.children.splice(i, 0, node);
    },
    resizeWithoutConstraints(w, h) { this.width = w; this.height = h; },
  };
  variants.forEach(v => { v.parent = set; });
  return set;
}

// Every combination of the given property values
function variants(values) {
  let combos = [{}];
  for (const [prop, list] of Object.entries(values)) {
    combos = combos.flatMap(c => list.map(v => ({ ...c, [prop]: v })));
  }
  return combos.map(component);
}

function runPlugin(sets) {
  const page = {
    children: [...sets], selection: [],
    async loadAsync() {},
    findAllWithCriteria: ({ types }) => sets.filter(s => types.includes(s.type)),
    insertChild(i, node) {
      const k = this.children.indexOf(node);
      if (k >= 0) this.children.splice(k, 1);
      this.children.splice(i, 0, node);
    },
    appendChild(node) { this.children.push(node); },
  };
  sets.forEach(s => { s.parent = page; });
  const notes = [];
  return new Promise(resolve => {
    const figma = {
      currentPage: page,
      notify: (msg, opts) => notes.push({ msg, error: Boolean(opts && opts.error) }),
      closePlugin: () => resolve(notes),
      viewport: { scrollAndZoomIntoView() {} },
    };
    vm.runInNewContext(CODE, { figma, console: { log() {}, error() {} } });
  });
}

// Rows of the laid-out set, top to bottom; each row lists its variants left to right as "Style/palette/Size"
function grid(set, paletteProp) {
  const rows = new Map();
  for (const v of set.children) {
    const centerY = Math.round(v.y + v.height / 2);
    if (!rows.has(centerY)) rows.set(centerY, []);
    rows.get(centerY).push(v);
  }
  return [...rows.keys()].sort((a, b) => a - b).map(y =>
    rows.get(y).sort((a, b) => a.x - b.x).map(v => {
      const p = v.variantProperties;
      return `${p.Style}/${p[paletteProp]}/${p.Size}`;
    }));
}

const EXPECTED_GRID = [
  ["regular/neutral/16", "regular/neutral/32"],
  ["regular/colored/16", "regular/colored/32"],
  ["filled/neutral/16", "filled/neutral/32"],
  ["filled/colored/16", "filled/colored/32"],
];

test("lays out sets by the Palette property: neutral rows above colored ones", async () => {
  const set = componentSet("add", variants({
    Set: ["fluent"], Style: ["filled", "regular"], Palette: ["colored", "neutral"], Size: ["32", "16"],
  }));

  const notes = await runPlugin([set]);

  assert.deepEqual(notes.filter(n => n.error), []);
  assert.deepEqual(grid(set, "Palette"), EXPECTED_GRID);
});

test("still lays out sets with the legacy Color property", async () => {
  const set = componentSet("add", variants({
    Set: ["fluent"], Style: ["filled", "regular"], Color: ["colored", "neutral"], Size: ["32", "16"],
  }));

  const notes = await runPlugin([set]);

  assert.deepEqual(notes.filter(n => n.error), []);
  assert.deepEqual(grid(set, "Color"), EXPECTED_GRID);
});

test("names the Palette property when a set lacks it", async () => {
  const set = componentSet("add", variants({ Set: ["fluent"], Style: ["regular"], Size: ["16"] }));

  const notes = await runPlugin([set]);

  const errors = notes.filter(n => n.error).map(n => n.msg);
  assert.ok(errors.some(m => m.includes("Style/Palette/Size")), errors.join("\n"));
});
