import assert from 'node:assert/strict';
import {join} from 'node:path';
import {test} from 'node:test';
import {resolveMatrixOutputDirectory} from './render-matrix.mjs';

test('a selected post renders below out/<brand>/posts/<id>', () => {
  assert.equal(
    resolveMatrixOutputDirectory('/repo', 'synthacon', 'next-owner'),
    join('/repo', 'out', 'synthacon', 'posts', 'next-owner'),
  );
});

test('the launch-wide matrix output path is unchanged without a post', () => {
  assert.equal(resolveMatrixOutputDirectory('/repo', 'synthacon'), join('/repo', 'out', 'synthacon', 'matrix'));
});
