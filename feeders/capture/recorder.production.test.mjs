import test from 'node:test';
import assert from 'node:assert/strict';
import {Recorder} from './recorder.mjs';

test('focus measures the subject rather than borrowing a click point', async () => {
  const r = new Recorder();
  r.start();
  await r.focus({boundingBox: async () => ({x: 100, y: 200, width: 420, height: 180})}, {padding: 20});
  const event = r.finish({width: 1440, height: 900}).events[0];
  assert.deepEqual({...event, t: 0}, {type: 'focus', t: 0, x: 310, y: 290, w: 460, h: 220});
});

test('focus fails loudly when the intended subject is not visible', async () => {
  const r = new Recorder();
  r.start();
  await assert.rejects(() => r.focus({boundingBox: async () => null}), /focus locator/);
});
