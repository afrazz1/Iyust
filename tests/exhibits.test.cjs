const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup() {
  const element = () => ({children: [], append(...items) {this.children.push(...items);}, replaceChildren() {this.children = [];}});
  const context = vm.createContext({document: {createElement: element}});
  vm.runInContext(fs.readFileSync(require.resolve('../exhibits.js'), 'utf8').replaceAll('export ', ''), context);
  const b = fs.readFileSync(require.resolve('../models/vitrina-1/vitrina-compressed.glb'));
  const json = JSON.parse(b.toString('utf8', 20, 20 + b.readUInt32LE(12)));
  const objects = json.nodes.map(n => ({name: n.name.replaceAll('.', ''), visible: true}));
  const gltf = {scene: {traverse(fn) {objects.forEach(fn);}}, parser: {json, associations: new Map(objects.map((o, nodes) => [o, {nodes}]))}};
  const panel = element(), list = element();
  return {objects, json, gltf, panel, list, controls: context.exhibitControls(panel, list)};
}

test('six source-named exhibits toggle independently, leaving frame and shelves visible', () => {
  const s = setup(); s.controls.load('vitrina-1', s.gltf);
  assert.equal(s.list.children.length, 6);
  const exhibitNames = ['cup', 'fish', 'lighthouse', 'tiger_1', 'tiger_2', 'tiger_plate.001'];
  s.list.children.forEach((row, index) => {
    const input = row.children[0];
    assert.equal(input.disabled, false);
    input.checked = false; input.onchange();
    s.objects.forEach((object, i) => assert.equal(object.visible, s.json.nodes[i].name !== exhibitNames[index]));
    input.checked = true; input.onchange();
  });
  assert.equal(s.list.children[5].children[1].textContent, 'Тарелка «Тигр и парусник»');
});

test('panel hides on other models and restores session choices on a fresh scene', () => {
  const s = setup(); s.controls.load('vitrina-1', s.gltf);
  const input = s.list.children[0].children[0]; input.checked = false; input.onchange();
  s.controls.load('lamp', s.gltf);
  assert.equal(s.panel.hidden, true); assert.equal(s.list.children.length, 0);
  const next = setup(); s.controls.load('vitrina-1', next.gltf);
  assert.equal(next.objects[next.json.nodes.findIndex(n => n.name === 'cup')].visible, false);
  assert.equal(s.panel.hidden, false);
  const fresh = setup(); fresh.controls.load('vitrina-1', fresh.gltf);
  assert.ok(fresh.objects.every(o => o.visible));
});

test('missing exhibit disables its switch without targeting a cabinet object', () => {
  const s = setup(); s.gltf.parser.associations.delete(s.objects[0]);
  s.controls.load('vitrina-1', s.gltf);
  assert.equal(s.list.children[5].children[0].disabled, true);
  assert.ok(s.objects.every(o => o.visible));
});
