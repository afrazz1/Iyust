const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');

// Exercise the editor's actual event handlers without a WebGL renderer.
function setup() {
  class Element {
    constructor() {
      this.children = []; this.dataset = {}; this.listeners = {};
      this.classList = {toggle() {}, add() {}, remove() {}};
    }
    append(...items) { this.children.push(...items); }
    replaceChildren() { this.children = []; }
    setAttribute() {}
    addEventListener(name, fn) { this.listeners[name] = fn; }
    querySelector() { return this.children.find(el => el.className === 'order-title'); }
    querySelectorAll() { return this.children; }
    focus() {}
    close() { this.open = false; }
    showModal() { this.open = true; }
    click() {}
    remove() {}
  }
  const elements = new Map();
  const $ = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const storage = new Map(), messages = [], visits = [];
  let rendered, blob, failSave = false, confirmed = true;
  class Vector3 {
    constructor(...values) { this.values = values; }
    clone() { return new Vector3(...this.values); }
  }
  const context = vm.createContext({
    document: {getElementById: $, createElement: () => new Element(), body: new Element(), querySelectorAll: () => [], addEventListener() {}},
    localStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => { if (failSave) throw Error('full'); storage.set(key, value); }},
    window: {confirm: () => confirmed}, Blob, URL: {createObjectURL: value => { blob = value; return 'blob:test'; }, revokeObjectURL() {}}, setTimeout() {}
  });
  vm.runInContext(readFileSync(require.resolve('../annotations.js'), 'utf8').replace('export function', 'function'), context);
  const controls = {enabled: true};
  const editor = context.annotationEditor({THREE: {Raycaster: class {}, Vector3}, canvas: new Element(), camera: {}, controls,
    getRoot: () => ({localToWorld: v => v}), fly: (p, t) => visits.push([p.values, t.values]), fit() {},
    createPoints: p => { rendered = JSON.parse(JSON.stringify(p)); }, notify: m => messages.push(m)});
  const points = ['A', 'B', 'C'].map((title, i) => ({title, description: `Text ${title}`, position: [i, 0, 0], view: {position: [i, 1, 2], target: [i, 0, 0]}}));
  const file = {format: 'object-notes', version: 1, modelId: 'lamp', points};
  editor.load({id: 'lamp', points: [[[0, 0, 0], 'Default']]});
  const upload = async data => { $('points-file').files = [{text: async () => typeof data === 'string' ? data : JSON.stringify(data)}]; await $('points-file').onchange(); };
  const download = async () => { $('points-download').onclick(); return JSON.parse(await blob.text()); };
  return {$, editor, controls, file, upload, download, storage, messages, visits,
    rendered: () => rendered, fail: () => { failSave = true; }, cancel: () => { confirmed = false; }};
}

test('JSON round trip preserves descriptions, coordinates, camera views and order', async () => {
  const s = setup(); await s.upload(s.file);
  assert.deepEqual(await s.download(), s.file);
  const other = setup(); await other.upload(await s.download());
  assert.deepEqual(other.rendered(), s.file.points.map(p => [p.position, p.title]));
  assert.equal(other.storage.size, 1);
});

test('drag and arrows persist tour order; tour follows moved camera views', async () => {
  const s = setup(); await s.upload(s.file); s.$('edit-mode').onclick();
  const rows = s.$('tour-order').children;
  rows[0].ondragstart({dataTransfer: {setData() {}}});
  rows[2].ondrop({preventDefault() {}});
  assert.deepEqual((await s.download()).points.map(p => p.title), ['B', 'C', 'A']);
  s.$('tour-order').children[1].children[2].onclick();
  assert.deepEqual((await s.download()).points.map(p => p.title), ['C', 'B', 'A']);
  s.$('tour-start').onclick();
  assert.equal(JSON.stringify(s.visits[0]), JSON.stringify([[2, 1, 2], [2, 0, 0]]));
  s.editor.unload(); s.editor.load({id: 'lamp', points: []});
  assert.deepEqual((await s.download()).points.map(p => p.title), ['C', 'B', 'A']);
});

test('invalid files, wrong model, unsupported versions and cancellation preserve data', async () => {
  const s = setup(); await s.upload(s.file); const before = await s.download();
  for (const data of ['{broken', {...s.file, modelId: 'avocado'}, {...s.file, version: 2}, {...s.file, points: [{...s.file.points[0], position: [null, 0, 0]}]}, {...s.file, points: [{...s.file.points[0], view: {}}]}]) {
    await s.upload(data); assert.deepEqual(await s.download(), before);
  }
  assert.equal(s.messages.length, 6);
  s.cancel(); await s.upload({...s.file, points: []}); assert.deepEqual(await s.download(), before);
});

test('empty backup clears points; storage failure leaves current tour and data intact', async () => {
  const s = setup(); await s.upload(s.file); s.$('tour-start').onclick(); s.fail();
  await s.upload({...s.file, points: []});
  assert.deepEqual(await s.download(), s.file); assert.equal(s.controls.enabled, false);
  const other = setup(); await other.upload({...other.file, points: []});
  assert.deepEqual(other.rendered(), []); assert.equal(other.$('tour-start').disabled, true);
});

test('switching models while reading a file prevents stale import', async () => {
  const s = setup(); let resolve;
  s.$('points-file').files = [{text: () => new Promise(r => { resolve = r; })}];
  const pending = s.$('points-file').onchange();
  s.editor.unload(); s.editor.load({id: 'avocado', points: []});
  resolve(JSON.stringify(s.file)); await pending;
  assert.deepEqual(s.rendered(), []); assert.equal(s.storage.size, 0);
});
