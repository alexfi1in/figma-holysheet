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

// Like Figma, inserting a node takes it out of its previous parent
function insertChild(parent, i, node) {
  if (node.parent && node.parent.children) {
    const k = node.parent.children.indexOf(node);
    if (k >= 0) node.parent.children.splice(k, 1);
  }
  parent.children.splice(i, 0, node);
  node.parent = parent;
}

function componentSet(name, variants) {
  const set = {
    type: "COMPONENT_SET", name, x: 0, y: 0, width: 0, height: 0, children: variants,
    insertChild(i, node) { insertChild(this, i, node); },
    resizeWithoutConstraints(w, h) { this.width = w; this.height = h; },
  };
  variants.forEach(v => { v.parent = set; });
  return set;
}

function frame(name, children) {
  const f = {
    type: "FRAME", name, x: 0, y: 0, children,
    insertChild(i, node) { insertChild(this, i, node); },
    findAllWithCriteria: ({ types }) => children.filter(c => types.includes(c.type)),
  };
  children.forEach(c => { c.parent = f; });
  return f;
}

// Every combination of the given property values
function variants(values) {
  let combos = [{}];
  for (const [prop, list] of Object.entries(values)) {
    combos = combos.flatMap(c => list.map(v => ({ ...c, [prop]: v })));
  }
  return combos.map(component);
}

// `sets` are all sets on the page (also those inside `frames`); sets without a parent lie on the page itself
function runPlugin(sets, { selection = [], frames = [], failLoad = false } = {}) {
  const page = {
    type: "PAGE", children: [], selection,
    async loadAsync() { if (failLoad) throw new Error("page failed to load"); },
    findAllWithCriteria: ({ types }) => sets.filter(s => types.includes(s.type)),
    insertChild(i, node) { insertChild(this, i, node); },
    appendChild(node) { insertChild(this, this.children.length, node); },
  };
  for (const node of [...sets.filter(s => !s.parent), ...frames]) page.appendChild(node);
  const notes = [];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the plugin never called closePlugin")), 1000);
    const figma = {
      currentPage: page,
      notify: (msg, opts) => notes.push({ msg, error: Boolean(opts && opts.error) }),
      closePlugin: () => { clearTimeout(timer); resolve(notes); },
      viewport: { scrollAndZoomIntoView() {} },
    };
    vm.runInNewContext(CODE, { figma, console: { log() {}, error() {} } });
  });
}

const errorsOf = notes => notes.filter(n => n.error).map(n => n.msg);
const atOrigin = set => set.children.every(v => v.x === 0 && v.y === 0);

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

test("keeps the single-color row first for the pre-2.0 values monochrome / multicolor", async () => {
  const set = componentSet("add", variants({
    Set: ["fluent"], Style: ["regular"], Color: ["multicolor", "monochrome"], Size: ["16"],
  }));

  await runPlugin([set]);

  assert.deepEqual(grid(set, "Color"), [["regular/monochrome/16"], ["regular/multicolor/16"]]);
});

test("puts unknown palette values after neutral and colored, alphabetically", async () => {
  const set = componentSet("add", variants({
    Set: ["fluent"], Style: ["regular"], Palette: ["zeta", "colored", "alpha", "neutral"], Size: ["16"],
  }));

  await runPlugin([set]);

  assert.deepEqual(grid(set, "Palette"), [
    ["regular/neutral/16"], ["regular/colored/16"], ["regular/alpha/16"], ["regular/zeta/16"],
  ]);
});

test("lays out a set with colored variants only", async () => {
  const set = componentSet("add", variants({
    Set: ["fluent"], Style: ["regular"], Palette: ["colored"], Size: ["20", "16"],
  }));

  const notes = await runPlugin([set]);

  assert.deepEqual(notes.filter(n => n.error), []);
  assert.deepEqual(grid(set, "Palette"), [["regular/colored/16", "regular/colored/20"]]);
});

test("places Set blocks left to right: fluent, desktop_classic, blazor_classic", async () => {
  const set = componentSet("add", variants({
    Set: ["blazor_classic", "fluent", "desktop_classic"], Style: ["regular"], Palette: ["neutral"], Size: ["16"],
  }));

  await runPlugin([set]);

  const row = [...set.children].sort((a, b) => a.x - b.x).map(v => v.variantProperties.Set);
  assert.deepEqual(row, ["fluent", "desktop_classic", "blazor_classic"]);
});

test("names the Palette property when a set lacks it", async () => {
  const set = componentSet("add", variants({ Set: ["fluent"], Style: ["regular"], Size: ["16"] }));

  const notes = await runPlugin([set]);

  const errors = notes.filter(n => n.error).map(n => n.msg);
  assert.ok(errors.some(m => m.includes("Style/Palette/Size")), errors.join("\n"));
});

const ICON = { Set: ["fluent"], Style: ["regular"], Palette: ["neutral"], Size: ["16"] };

// Whole-page mode

test("whole-page mode leaves sets inside frames in their frame and place", async () => {
  const onPage = componentSet("zeta", variants(ICON));
  const inFrame = componentSet("alpha", variants(ICON));
  inFrame.x = 500; inFrame.y = 300;
  const drafts = frame("Drafts", [inFrame]);

  await runPlugin([onPage, inFrame], { frames: [drafts] });

  assert.equal(inFrame.parent, drafts);
  assert.deepEqual([inFrame.x, inFrame.y], [500, 300]);
  assert.deepEqual(grid(inFrame, "Palette"), [["regular/neutral/16"]]);
  assert.equal(onPage.parent.type, "PAGE");
  assert.deepEqual([onPage.x, onPage.y], [0, 0]);
});

test("whole-page mode keeps a skipped set in the row instead of under the others", async () => {
  const a = componentSet("a", variants(ICON));
  const noPalette = componentSet("b", variants({ Set: ["fluent"], Style: ["regular"], Size: ["16"] }));
  noPalette.width = 100; noPalette.height = 50;
  const c = componentSet("c", variants(ICON));
  a.x = 500; c.x = 1000;

  await runPlugin([a, noPalette, c]);

  assert.deepEqual([a.x, noPalette.x, c.x], [0, a.width + 20, a.width + 20 + 100 + 20]);
  assert.deepEqual([a.y, noPalette.y, c.y], [0, 0, 0]);
});

// Selection

test("a selected variant lays out its own set and leaves the rest of the page alone", async () => {
  const a = componentSet("a", variants(ICON));
  const b = componentSet("b", variants(ICON));
  a.x = 300; b.x = 900; b.y = 400;

  const notes = await runPlugin([a, b], { selection: [a.children[0]] });

  assert.deepEqual(errorsOf(notes), []);
  assert.ok(!atOrigin(a), "set a was laid out");
  assert.equal(a.x, 300);
  assert.deepEqual([b.x, b.y], [900, 400]);
  assert.ok(atOrigin(b), "set b was not touched");
});

test("a selected frame lays out the sets inside it", async () => {
  const outside = componentSet("a", variants(ICON));
  outside.x = 700;
  const inside = componentSet("b", variants(ICON));
  inside.x = 40;
  const drafts = frame("Drafts", [inside]);

  await runPlugin([outside, inside], { selection: [drafts], frames: [drafts] });

  assert.ok(!atOrigin(inside), "the set in the frame was laid out");
  assert.equal(inside.x, 40);
  assert.equal(outside.x, 700);
  assert.ok(atOrigin(outside), "the set outside was not touched");
});

test("a selection without component sets changes nothing and says what to select", async () => {
  const a = componentSet("a", variants(ICON));
  a.x = 300;

  const notes = await runPlugin([a], { selection: [{ type: "TEXT", name: "note" }] });

  assert.equal(a.x, 300);
  assert.ok(atOrigin(a));
  assert.ok(errorsOf(notes).some(m => /component set/i.test(m)), errorsOf(notes).join("\n"));
});

// Failures

test("a set that throws is reported and the other sets are still laid out", async () => {
  const broken = componentSet("broken", variants(ICON));
  Object.defineProperty(broken.children[0], "variantProperties", {
    get() { throw new Error("Component set has existing errors"); },
  });
  const fine = componentSet("fine", variants(ICON));

  const notes = await runPlugin([broken, fine]);

  assert.ok(errorsOf(notes).some(m => m.includes("broken") && m.includes("existing errors")), errorsOf(notes).join("\n"));
  assert.deepEqual(grid(fine, "Palette"), [["regular/neutral/16"]]);
});

test("an unexpected failure closes the plugin with a message", async () => {
  const a = componentSet("a", variants(ICON));

  const notes = await runPlugin([a], { failLoad: true });

  assert.ok(errorsOf(notes).some(m => m.includes("page failed to load")), errorsOf(notes).join("\n"));
});

// Row and block order

test("orders styles regular, light, filled, and unknown styles after them alphabetically", async () => {
  const set = componentSet("add", variants({
    Set: ["fluent"], Style: ["zeta", "filled", "light", "alpha", "regular"], Palette: ["neutral"], Size: ["16"],
  }));

  await runPlugin([set]);

  assert.deepEqual(grid(set, "Palette").map(row => row[0].split("/")[0]), ["regular", "light", "filled", "alpha", "zeta"]);
});

test("puts an unknown Set block after the known ones, so it never becomes the default variant", async () => {
  const set = componentSet("add", variants({
    Set: ["blazor_classic", "rtl", "fluent", "desktop_classic"], Style: ["regular"], Palette: ["neutral"], Size: ["16"],
  }));

  await runPlugin([set]);

  const row = [...set.children].sort((a, b) => a.x - b.x).map(v => v.variantProperties.Set);
  assert.deepEqual(row, ["fluent", "desktop_classic", "blazor_classic", "rtl"]);
});
