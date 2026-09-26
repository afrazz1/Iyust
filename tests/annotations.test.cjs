const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');

// Exercise the editor's actual event handlers without a WebGL renderer.
function setup(unlocked = true) {
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
    select() {}
    setCustomValidity() {}
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
    normalize() { const n = Math.hypot(...this.values); this.values = this.values.map(v => v / n); return this; }
    addScaledVector(v, n) { this.values = this.values.map((x, i) => x + v.values[i] * n); return this; }
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
  const login = (code = 'экспозиция-команда') => {
    $('edit-mode').onclick(); $('access-code').value = code;
    $('access-form').listeners.submit({preventDefault() {}});
  };
  if (unlocked) login();
  const upload = async data => { $('points-file').files = [{text: async () => typeof data === 'string' ? data : JSON.stringify(data)}]; await $('points-file').onchange(); };
  const download = async () => { $('points-download').onclick(); return JSON.parse(await blob.text()); };
  return {$, editor, controls, file, upload, download, storage, messages, visits, login,
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
  const s = setup(); await s.upload(s.file);
  const rows = s.$('tour-order').children;
  rows[0].ondragstart({dataTransfer: {setData() {}}});
  rows[2].ondrop({preventDefault() {}});
  assert.deepEqual((await s.download()).points.map(p => p.title), ['B', 'C', 'A']);
  s.$('tour-order').children[1].children[2].onclick();
  assert.deepEqual((await s.download()).points.map(p => p.title), ['C', 'B', 'A']);
  s.$('tour-start').onclick();
  assert.equal(JSON.stringify(s.visits[0]), JSON.stringify([[2, 1, 2], [2, 0, 0]]));
  s.editor.unload(); s.editor.load({id: 'lamp', points: []});
  s.login();
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
  const s = setup(); await s.upload(s.file); s.fail();
  await s.upload({...s.file, points: []});
  assert.deepEqual(await s.download(), s.file);
  const other = setup(); await other.upload({...other.file, points: []});
  assert.deepEqual(other.rendered(), []); assert.equal(other.$('tour-start').disabled, true);
});

test('view mode hides editing actions and refuses mutations; code unlocks and exit relocks', async () => {
  const s = setup(false);
  for (const id of ['point-edit', 'points-upload', 'points-download', 'order-panel']) assert.equal(s.$(id).hidden, true);
  s.editor.select(0);
  assert.equal(s.$('point-panel').hidden, false);
  assert.equal(s.$('point-title').textContent, 'Default');
  s.$('point-edit').onclick();
  assert.ok(!s.$('point-editor').open);
  s.$('point-delete').onclick();
  s.$('point-form').listeners.submit({preventDefault() {}});
  await s.upload(s.file);
  assert.equal(s.storage.size, 0);
  s.login('wrong');
  assert.equal(s.$('editor-access').open, true);
  assert.equal(s.$('access-error').textContent, 'Неверный код доступа.');
  assert.equal(s.$('order-panel').hidden, true);
  s.$('access-code').value = 'экспозиция-команда';
  s.$('access-form').listeners.submit({preventDefault() {}});
  assert.equal(s.$('order-panel').hidden, false);
  await s.upload(s.file);
  s.editor.select(0);
  assert.equal(s.$('point-editor').open, true);
  s.$('edit-mode').onclick();
  assert.equal(s.$('point-editor').open, false);
  assert.equal(s.$('points-upload').hidden, true);
  await s.upload({...s.file, points: []});
  assert.equal(s.rendered().length, 3);
});

test('leaving editor during file read refuses stale import even after re-entry', async () => {
  const s = setup(); let resolve;
  s.$('points-file').files = [{text: () => new Promise(r => { resolve = r; })}];
  const pending = s.$('points-file').onchange();
  s.$('edit-mode').onclick(); s.login();
  resolve(JSON.stringify(s.file)); await pending;
  assert.equal(s.storage.size, 0);
});

test('tour navigation visits each point in both directions and closes editor access', async () => {
  const s = setup(); await s.upload(s.file);
  s.$('tour-start').onclick();
  s.$('tour-next').onclick(); s.$('tour-prev').onclick();
  assert.deepEqual(s.visits.map(v => v[0][0]), [0, 1, 0]);
  assert.equal(s.$('point-title').textContent, 'A');
  assert.equal(s.$('point-description').textContent, 'Text A');
  assert.equal(s.$('points-upload').hidden, true);
});

test('switching models while reading a file prevents stale import', async () => {
  const s = setup(); let resolve;
  s.$('points-file').files = [{text: () => new Promise(r => { resolve = r; })}];
  const pending = s.$('points-file').onchange();
  s.editor.unload(); s.editor.load({id: 'avocado', points: []});
  resolve(JSON.stringify(s.file)); await pending;
  assert.deepEqual(s.rendered(), []); assert.equal(s.storage.size, 0);
});
