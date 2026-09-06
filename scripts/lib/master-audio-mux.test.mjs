import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {muxMasterAudio} from './master-audio-mux.mjs';

const meanVolumeDb = (file) => {
  const r = spawnSync('ffmpeg', ['-i', file, '-af', 'volumedetect', '-f', 'null', '-'], {encoding: 'utf8'});
  return Number((String(r.stderr).match(/mean_volume:\s+(-?[\d.]+)/) || [])[1]);
};

const frameCount = (file) => {
  const out = execFileSync('ffprobe', [
    '-v', 'error', '-count_frames', '-select_streams', 'v:0',
    '-show_entries', 'stream=nb_read_frames',
    '-of', 'default=nokey=1:noprint_wrappers=1', file,
  ], {encoding: 'utf8'});
  return Number(out.trim());
};

test('muxMasterAudio replaces the row audio with the master audio, keeping the row video intact', () => {
  const dir = mkdtempSync(join(tmpdir(), 'master-audio-mux-test-'));
  try {
    const rowVideo = join(dir, 'row.mp4');
    const master = join(dir, 'master.mp4');
    // Silent 2s row: testsrc2 at 30fps, no audio stream.
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=64x36:rate=30',
      '-t', '2', '-pix_fmt', 'yuv420p', '-an', rowVideo,
    ]);
    // Tone "master": audio only, no video stream, slightly SHORTER than the row
    // (real production rows and the scored hero master differ by a few ms even on
    // the same picture-locked timeline). Measured 2026-09-06: -shortest on a
    // stream-copied mux trimmed 3-4 TRAILING VIDEO frames off a real matrix row for
    // a master only ~3ms shorter than the video — this mismatch reproduces that
    // class of bug at test scale, so a regression back to -shortest fails this test.
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
      '-t', '1.9', '-c:a', 'aac', master,
    ]);
    const expectedFrames = frameCount(rowVideo);
    const expectedVolume = meanVolumeDb(master);

    muxMasterAudio(rowVideo, master);

    assert.equal(frameCount(rowVideo), expectedFrames);
    assert.equal(meanVolumeDb(rowVideo), expectedVolume);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
