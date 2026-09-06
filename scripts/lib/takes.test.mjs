import assert from 'node:assert/strict';
import test from 'node:test';
import {renderTake} from './takes.mjs';

test('renderTake rejects shell-shaped compositions and frame ranges before I/O', () => {
  const base = {outPath: 'unused.mp4', props: {}, publicDir: 'unused-public'};
  assert.throws(() => renderTake({...base, comp: 'LaunchVideo && whoami'}), /unregistered composition/);
  assert.throws(() => renderTake({...base, comp: 'LaunchVideo', frames: '1-20 && whoami'}), /invalid frame range/);
});
