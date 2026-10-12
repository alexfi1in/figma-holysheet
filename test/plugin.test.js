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

// Plugin data and remove(), as every Figma node has them
function withNodeBasics(node) {
  const data = {};
  node.getPluginData = key => data[key] || "";
  node.setPluginData = (key, value) => { data[key] = value; };
  node.remove = () => {
    const k = node.parent ? node.parent.children.indexOf(node) : -1;
    if (k >= 0) node.parent.children.splice(k, 1);
    node.parent = null;
  };
  return node;
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
  const set = withNodeBasics({
    type: "COMPONENT_SET", name, x: 0, y: 0, width: 0, height: 0, children: variants,
    insertChild(i, node) { insertChild(this, i, node); },
    resizeWithoutConstraints(w, h) { this.width = w; this.height = h; },
    get absoluteBoundingBox() {
      const p = this.parent && this.parent.type === "FRAME" ? this.parent : { x: 0, y: 0 };
      return { x: p.x + this.x, y: p.y + this.y, width: this.width, height: this.height };
    },
  });
  variants.forEach(v => { v.parent = set; });
  return set;
}

function frame(name, children) {
  const f = withNodeBasics({
    type: "FRAME", name, x: 0, y: 0, children,
    insertChild(i, node) { insertChild(this, i, node); },
    findAllWithCriteria: ({ types }) => children.filter(c => types.includes(c.type)),
  });
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

function textNode(characters = "") {
  return withNodeBasics({
    type: "TEXT", name: "Text", characters, x: 0, y: 0, width: 400,
    get height() { return this.characters.split("\n").length * 16; },
    setRangeFontName() {}, setRangeFontSize() {}, setRangeFills() {},
  });
}

// `sets` are all sets on the page (also those inside `frames`); sets without a parent lie on the page itself
function makePage(sets, { selection = [], frames = [], others = [], failLoad = false } = {}) {
  const page = {
    type: "PAGE", children: [], selection, failLoad,
    async loadAsync() { if (this.failLoad) throw new Error("page failed to load"); },
    findAllWithCriteria: ({ types }) => sets.filter(s => types.includes(s.type)),
    insertChild(i, node) { insertChild(this, i, node); },
    appendChild(node) { insertChild(this, this.children.length, node); },
  };
  for (const node of [...sets.filter(s => !s.parent), ...frames, ...others]) page.appendChild(node);
  return page;
}

// Runs the plugin once; resolves with its notifications, plus `zooms` (every scrollAndZoomIntoView call)
function runOn(page) {
  const notes = [];
  notes.zooms = [];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the plugin never called closePlugin")), 1000);
    const figma = {
      currentPage: page,
      notify: (msg, opts) => notes.push({ msg, error: Boolean(opts && opts.error) }),
      closePlugin: () => { clearTimeout(timer); resolve(notes); },
      viewport: { scrollAndZoomIntoView: nodes => notes.zooms.push(nodes) },
      createText: () => textNode(),
      loadFontAsync: async () => {},
    };
    vm.runInNewContext(CODE, { figma, console: { log() {}, error() {} } });
  });
}

const runPlugin = (sets, options) => runOn(makePage(sets, options));

// The plugin's report texts on the page (anything else on the page is the designer's)
const reportsOn = page => page.children.filter(n => n.type === "TEXT" && n.name === "HolySheet report");

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

const ICON = { Set: ["fluent"], Style: ["regular"], Palette: ["neutral"], Size: ["16"] };

// Whole-page mode

test("with nothing selected, lays out every set on the page and lines them up by name (by design)", async () => {
  const c = componentSet("c", variants(ICON));
  const a = componentSet("a", variants(ICON));
  const b = componentSet("b", variants(ICON));
  c.x = 50; a.x = 900; a.y = 300; b.x = 400;

  const notes = await runPlugin([c, a, b]);

  assert.deepEqual(errorsOf(notes), []);
  for (const set of [a, b, c]) assert.deepEqual(grid(set, "Palette"), [["regular/neutral/16"]]);
  assert.deepEqual([a.x, b.x, c.x], [0, a.width + 20, a.width + 20 + b.width + 20]);
  assert.deepEqual([a.y, b.y, c.y], [0, 0, 0]);
  assert.deepEqual(a.parent.children.map(s => s.name), ["a", "b", "c"]);
  assert.ok(notes.some(n => n.msg.includes("3 ComponentSets updated")));
});

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

test("names the Palette property when a set lacks it", async () => {
  const page = makePage([componentSet("add", variants({ Set: ["fluent"], Style: ["regular"], Size: ["16"] }))]);

  await runOn(page);

  assert.match(reportsOn(page)[0].characters, /Style\/Palette\/Size/);
});

// Problems stop the run: nothing changes, a report on the canvas lists them

const noPalette = name => componentSet(name, variants({ Set: ["fluent"], Style: ["regular"], Size: ["16"] }));

test("a set with a problem stops the run: nothing changes, the report lists it and the viewport shows it", async () => {
  const a = componentSet("a", variants(ICON));
  const b = noPalette("b");
  const c = componentSet("c", variants(ICON));
  a.x = 500; b.x = 0; c.x = 1000;
  const page = makePage([a, b, c]);

  const notes = await runOn(page);

  assert.ok(atOrigin(a) && atOrigin(b) && atOrigin(c), "no variant moved");
  assert.deepEqual([a.x, b.x, c.x], [500, 0, 1000]);
  assert.ok(errorsOf(notes).some(m => m.includes("Nothing was changed")), errorsOf(notes).join("\n"));
  const [report] = reportsOn(page);
  assert.match(report.characters, /• b\n.*Missing required variant properties/);
  assert.doesNotMatch(report.characters, /• a\b|• c\b/);
  // the array comes from the plugin's vm context, so compare its items
  assert.deepEqual([...notes.zooms.at(-1)], [report]);
});

test("the report lists every problem of every set", async () => {
  const twins = componentSet("twins", [...variants(ICON), ...variants(ICON)]);
  const turned = componentSet("turned", variants(ICON));
  turned.children[0].rotation = 90;
  const bare = noPalette("bare");
  const broken = componentSet("broken", variants(ICON));
  Object.defineProperty(broken.children[0], "variantProperties", {
    get() { throw new Error("Component set has existing errors"); },
  });
  const page = makePage([twins, turned, bare, broken]);

  await runOn(page);

  const text = reportsOn(page)[0].characters;
  for (const expected of [
    /• bare\n.*Missing required variant properties/,
    /• broken\n.*Component set has existing errors/,
    /• turned\n.*Rotation.*Set=fluent, Style=regular, Palette=neutral, Size=16/,
    /• twins\n.*Duplicate variant properties/,
  ]) assert.match(text, expected);
});

test("the report sits above the sets in page coordinates without covering them", async () => {
  const b = noPalette("b");
  b.x = 20; b.y = 30;
  const drafts = frame("Drafts", [b]);
  drafts.x = 1000; drafts.y = 500;
  const page = makePage([b], { frames: [drafts] });

  await runOn(page);

  const [report] = reportsOn(page);
  assert.equal(report.parent, page);
  assert.equal(report.x, 1020);
  assert.ok(report.y + report.height <= 530, `report ends at ${report.y + report.height}, the set starts at 530`);
});

test("a new run replaces the previous report, a clean run removes it, the designer's texts stay", async () => {
  const b = noPalette("b");
  const designersNote = textNode("my notes");
  designersNote.name = "HolySheet report";
  const page = makePage([b], { others: [designersNote] });

  await runOn(page);
  await runOn(page);
  assert.equal(page.children.filter(n => n.type === "TEXT").length, 2, "the designer's note and one report");

  for (const v of b.children) v.variantProperties = { ...v.variantProperties, Palette: "neutral" };
  const notes = await runOn(page);

  assert.deepEqual(errorsOf(notes), []);
  assert.deepEqual(page.children.filter(n => n.type === "TEXT"), [designersNote]);
  assert.ok(!atOrigin(b), "b was laid out");
});

test("a failure while laying out closes the plugin with a message naming the set", async () => {
  const a = componentSet("a", variants(ICON));
  const b = componentSet("b", variants(ICON));
  b.resizeWithoutConstraints = () => { throw new Error("boom"); };

  const notes = await runPlugin([a, b]);

  assert.ok(errorsOf(notes).some(m => m.includes('"b"') && m.includes("boom")), errorsOf(notes).join("\n"));
});
