import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreWindowState, trayWindowBounds } from '../desktop/window-state.mjs';

const display = (x, y, width, height) => ({ workArea: { x, y, width, height } });
const primary = display(0, 25, 1280, 775);

test('default desktop bounds fit the current work area', () => {
  const state = restoreWindowState(null, [primary], primary);
  assert.deepEqual(state.bounds, { x: 0, y: 25, width: 1280, height: 775 });
  assert.equal(state.minWidth, 720);
  assert.equal(state.minHeight, 520);
  assert.equal(state.maximized, false);
});

test('restoration preserves valid size, position and maximized state on a negative-coordinate display', () => {
  const secondary = display(-1600, 25, 1600, 975);
  const bounds = { x: -1400, y: 100, width: 800, height: 600 };
  const state = restoreWindowState({ bounds, maximized: true }, [primary, secondary], primary);
  assert.deepEqual(state.bounds, bounds);
  assert.equal(state.maximized, true);
});

test('a disconnected monitor cannot leave a restored window off screen', () => {
  const state = restoreWindowState({ bounds: { x: 2600, y: -200, width: 1500, height: 1200 } }, [primary], primary);
  assert.deepEqual(state.bounds, { x: 0, y: 25, width: 1280, height: 775 });
});

test('malformed window state falls back safely and tiny displays override minimum size', () => {
  const small = display(20, 20, 640, 480);
  for (const bounds of [null, {}, { x: 0, y: 0, width: -1, height: 900 }, { x: '30', y: 0, width: 800, height: 900 }]) {
    const state = restoreWindowState({ bounds, maximized: true }, [small], small);
    assert.deepEqual(state.bounds, { x: 20, y: 20, width: 640, height: 480 });
    assert.equal(state.minWidth, 640);
    assert.equal(state.minHeight, 480);
    assert.equal(state.maximized, false);
  }
});

test('tray stays inside work area at every screen edge, including very small displays', () => {
  for (const workArea of [primary.workArea, display(-600, -400, 360, 480).workArea]) {
    for (const anchor of [
      { x: workArea.x, y: workArea.y - 25, width: 40, height: 25 },
      { x: workArea.x + workArea.width - 40, y: workArea.y + workArea.height, width: 40, height: 25 },
      { x: workArea.x - 100, y: workArea.y - 100, width: 40, height: 25 }
    ]) {
      const bounds = trayWindowBounds(anchor, workArea);
      assert.ok(bounds.x >= workArea.x);
      assert.ok(bounds.y >= workArea.y);
      assert.ok(bounds.x + bounds.width <= workArea.x + workArea.width);
      assert.ok(bounds.y + bounds.height <= workArea.y + workArea.height);
    }
  }
});
