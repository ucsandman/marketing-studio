export function validateManifest(json) {
  // Check version
  if (json.version !== 1) {
    throw new Error(`version must be 1, got ${json.version}`);
  }

  // Check required fields
  const required = ['video', 'captions', 'fps', 'exportedAt', 'segments'];
  for (const field of required) {
    if (!(field in json)) {
      throw new Error(`missing required field: ${field}`);
    }
  }

  // Validate segments
  if (!Array.isArray(json.segments)) {
    throw new Error('segments must be an array');
  }

  const seenIds = new Set();
  for (const segment of json.segments) {
    // Check required segment fields
    if (!('id' in segment)) throw new Error('segment missing id');
    if (!('title' in segment)) throw new Error('segment missing title');
    if (!('startSec' in segment)) throw new Error('segment missing startSec');
    if (!('endSec' in segment)) throw new Error('segment missing endSec');

    // Check times are finite and non-negative
    if (!Number.isFinite(segment.startSec) || segment.startSec < 0) {
      throw new Error(`segment ${segment.id}: startSec must be a non-negative finite number`);
    }
    if (!Number.isFinite(segment.endSec) || segment.endSec < 0) {
      throw new Error(`segment ${segment.id}: endSec must be a non-negative finite number`);
    }

    // Check endSec > startSec
    if (segment.endSec <= segment.startSec) {
      throw new Error(`segment ${segment.id}: endSec must be greater than startSec`);
    }

    // Check for duplicate ids
    if (seenIds.has(segment.id)) {
      throw new Error(`duplicate segment id: ${segment.id}`);
    }
    seenIds.add(segment.id);
  }

  return json;
}

function timeToSeconds(timeStr) {
  // Format: HH:MM:SS,mmm
  const parts = timeStr.match(/(\d+):(\d+):(\d+),(\d+)/);
  if (!parts) throw new Error(`invalid time format: ${timeStr}`);
  const [, hours, minutes, seconds, millis] = parts;
  return parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds) + parseInt(millis) / 1000;
}

export function parseSrt(text) {
  // Normalize line endings
  const normalized = text.replace(/\r\n/g, '\n');
  // Split by blank lines (one or more consecutive newlines)
  const blocks = normalized.split(/\n\s*\n/).filter(b => b.trim());

  const cues = [];
  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length < 2) continue; // Skip malformed blocks

    // First line is index, second line is timecode
    const timecodeLine = lines[1];
    const match = timecodeLine.match(/^(.+?)\s+-->\s+(.+?)$/);
    if (!match) continue;

    const startSec = timeToSeconds(match[1]);
    const endSec = timeToSeconds(match[2]);
    const text = lines.slice(2).join(' ');

    cues.push({startSec, endSec, text});
  }

  return cues;
}

export function windowCues(cues, startSec, endSec) {
  return cues
    .filter(cue => cue.endSec > startSec && cue.startSec < endSec)
    .map(cue => ({
      startSec: Math.max(cue.startSec, startSec) - startSec,
      endSec: Math.min(cue.endSec, endSec) - startSec,
      text: cue.text
    }));
}
