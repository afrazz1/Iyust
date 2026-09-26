const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');

// Run the viewer's actual flight functions with a deterministic clock.
function setup(reduced = false) {
  class Vector {
    constructor(x = 0) { this.x = x; }
    clone() { return new Vector(this.x); }
    copy(v) { this.x = v.x; return this; }
    lerpVectors(a, b, t) { this.x = a.x + (b.x - a.x) * t; return this; }
  }
  let now = 0;
  const camera = {position: new Vector(), lookAt(v) { this.target = v.x; }};
  const controls = {target: new Vector(), enabled: true, enableDamping: true, update() {}};
  const context = vm.createContext({camera, controls, reduced, performance: {now: () => now}});
  const html = readFileSync(require.resolve('../index.html'), 'utf8');
  vm.runInContext('let tween=null;\n' + html.slice(html.indexOf('function fly('), html.indexOf('function updatePoints(')), context);
  return {camera, controls, move: (p, t) => context.fly(new Vector(p), new Vector(t), 850),
    tick: time => { now = time; context.updateTween(time); }};
}

test('flight interpolates position and orbit target, then restores free controls', () => {
  const s = setup(); s.move(10, 4);
  assert.equal(s.camera.position.x, 0);
  assert.equal(s.controls.enabled, false);
  s.tick(425);
  assert.ok(s.camera.position.x > 0 && s.camera.position.x < 10);
  assert.ok(s.controls.target.x > 0 && s.controls.target.x < 4);
  assert.equal(s.camera.target, s.controls.target.x);
  assert.equal(s.controls.enabled, false);
  s.tick(850);
  assert.equal(s.camera.position.x, 10);
  assert.equal(s.controls.target.x, 4);
  assert.equal(s.controls.enabled, true);
  s.camera.position.x = 12; s.tick(1000);
  assert.equal(s.camera.position.x, 12);
});

test('rapid navigation replaces flight from its current position without a jump', () => {
  const s = setup(); s.move(10, 4); s.tick(300);
  const current = s.camera.position.x;
  s.move(-5, -2);
  assert.equal(s.camera.position.x, current);
  s.tick(850);
  assert.equal(s.controls.enabled, false);
  s.tick(1150);
  assert.equal(s.camera.position.x, -5);
  assert.equal(s.controls.target.x, -2);
  assert.equal(s.controls.enabled, true);
});

test('reduced motion reaches target immediately and leaves controls available', () => {
  const s = setup(true); s.move(10, 4);
  assert.equal(s.camera.position.x, 10);
  assert.equal(s.controls.target.x, 4);
  assert.equal(s.controls.enabled, true);
});
