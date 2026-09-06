// Replace an mp4's audio track with another file's audio, both streams stream
// copied — used by render-matrix.mjs to swap a production row's unmastered render
// (Remotion's internal VO+bed mix) for the scored hero master's audio. Row and
// master share the same picture-locked timeline, so no offset is needed.
//
// Atomic: muxes into a temp file in the SAME directory as videoPath, then renames
// over the original, so a mid-mux failure never leaves a partially-written file at
// the real path (matches render-matrix.mjs's remuxFaststart/reencodeToBudget).
import {existsSync, renameSync, unlinkSync} from 'node:fs';
import {ffmpeg} from './remotion.mjs';

export function muxMasterAudio(videoPath, masterAudioPath) {
  const tmpPath = `${videoPath}.master-audio.tmp.mp4`;
  // No -shortest: the row's video and the master's audio are already within a few
  // milliseconds of each other (same picture-locked timeline). Measured 2026-09-06:
  // with stream-copied audio+video, -shortest's cutoff is imprecise and trimmed 3-4
  // TRAILING video frames off a Truckside row despite the master's audio being only
  // ~3ms shorter than the video — breaking judge-production's exact frame-count gate.
  // Omitting it keeps every video frame; any leftover fraction-of-a-frame of silence
  // at the very end (audio a few ms shorter than video, or vice versa) is inaudible.
  ffmpeg([
    '-y', '-i', videoPath, '-i', masterAudioPath,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-c:a', 'copy',
    '-movflags', '+faststart',
    tmpPath,
  ]);
  if (!existsSync(tmpPath)) {
    throw new Error(`master-audio mux did not produce ${tmpPath}`);
  }
  unlinkSync(videoPath);
  renameSync(tmpPath, videoPath);
}
