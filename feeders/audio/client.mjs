#!/usr/bin/env node
/**
 * ElevenLabs audio feeder: voiceover lines and exact-length music tracks.
 * NON-LOAD-BEARING: missing key exits 2 with guidance; videos render silent.
 *
 * Usage:
 *   node feeders/audio/client.mjs vo --project <repo> --script <script.json> --out <dir> [--timestamps] [--brand <id>]
 *   node feeders/audio/client.mjs music --project <repo> --prompt "<text>" --length-ms <n> --out <file>
 *   node feeders/audio/client.mjs sfx --project <repo> --prompt "<text>" --duration-sec <n> --out <file>
 *   node feeders/audio/client.mjs probe --file <mp3>
 *   node feeders/audio/client.mjs words --project <repo> --file <mp3> --text "<spoken text>" --out <words.json>
 *
 * --brand <id> (vo only) selects ELEVENLABS_VOICE_ID_<BRAND> (id uppercased,
 * dashes -> underscores) over the global ELEVENLABS_VOICE_ID/default voice.
 */
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {projectArg, resolveWorkspace, resolveWorkspacePath} from '../../scripts/lib/workspace.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const API = 'https://api.elevenlabs.io';
const DEFAULT_VOICE = '21m00Tcm4TlvDq8ikWAM'; // Rachel (premade)
const TTS_TIMEOUT = 60_000;
const MUSIC_TIMEOUT = 300_000;
const SFX_TIMEOUT = 120_000;

export const buildTtsUrl = (voiceId) =>
  `${API}/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;

// Verified endpoint (Context7, /websites/elevenlabs_io): POST
// /v1/text-to-speech/{voice_id}/with-timestamps returns JSON
// {audio_base64, alignment:{characters, character_start_times_seconds,
// character_end_times_seconds}, normalized_alignment:{...}}.
export const buildTtsTimestampsUrl = (voiceId) =>
  `${API}/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`;

/**
 * Char-level ElevenLabs alignment -> word table.
 *
 * Uses `alignment`, NEVER `normalized_alignment`: raw characters[] are 1:1 with the
 * submitted text, so word index i here equals word index i in
 * line.text.trim().split(/\s+/). normalized_alignment expands numerals and
 * abbreviations and destroys that index alignment.
 *
 * @param {{characters: string[], character_start_times_seconds: number[], character_end_times_seconds: number[]}} alignment
 * @param {string} text  the EXACT text submitted to the endpoint
 * @returns {{w: string, startMs: number, endMs: number}[]}
 */
export const aggregateWords = (alignment, text) => {
  const chars = alignment?.characters ?? [];
  const starts = alignment?.character_start_times_seconds ?? [];
  const ends = alignment?.character_end_times_seconds ?? [];
  if (chars.length !== starts.length || chars.length !== ends.length) {
    throw new Error(
      `alignment arrays disagree: ${chars.length} chars, ${starts.length} starts, ${ends.length} ends`,
    );
  }
  const words = [];
  let current = null; // {w, firstIdx, lastIdx}
  chars.forEach((ch, i) => {
    // A word is a maximal run of non-whitespace characters; punctuation stays
    // attached to its word, which keeps `w` identical to the whitespace-split token.
    if (/\s/.test(ch)) {
      current = null;
      return;
    }
    if (!current) {
      current = {w: ch, firstIdx: i, lastIdx: i};
      words.push(current);
      return;
    }
    current.w += ch;
    current.lastIdx = i;
  });
  if (words.length === 0) throw new Error('no word-level timestamps in alignment');
  const out = words.map(({w, firstIdx, lastIdx}) => {
    const startMs = Math.round(starts[firstIdx] * 1000);
    const endMs = Math.round(ends[lastIdx] * 1000);
    return {w, startMs, endMs: Math.max(endMs, startMs + 1)};
  });
  for (let i = 1; i < out.length; i++) {
    if (out[i].startMs < out[i - 1].startMs) {
      throw new Error(`non-monotonic word starts at index ${i}`);
    }
  }
  // Round-trip assertion: the table must reconstruct the sentence it was aligned to,
  // or every cue derived from it points at the wrong word.
  if (out.map((w) => w.w).join(' ') !== String(text).trim().replace(/\s+/g, ' ')) {
    throw new Error('alignment does not reconstruct the submitted text');
  }
  return out;
};

/**
 * Fallback: even-distribution word times derived from an already-rendered mp3.
 * Even distribution ONLY — no char-length weighting. The caller sets
 * `wordsEstimated: true`; sync is approximate wherever the narrator pauses.
 * @param {string} text
 * @param {number} durationMs  measured with measureMs()/probe
 * @returns {{w: string, startMs: number, endMs: number}[]}
 */
export const estimateWords = (text, durationMs) => {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) throw new Error('estimateWords requires non-empty text');
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error('estimateWords requires durationMs > 0');
  }
  const slot = durationMs / words.length;
  return words.map((w, i) => ({
    w,
    startMs: Math.round(i * slot),
    endMs: Math.round((i + 1) * slot),
  }));
};

export const buildMusicBody = (prompt, lengthMs) => ({
  prompt,
  music_length_ms: lengthMs,
  model_id: 'music_v2',
});

// Text-to-sound-effects (verified endpoint, Context7): POST /v1/sound-generation,
// body {text, duration_seconds (0.5-30), model_id}, header xi-api-key, returns mp3.
export const buildSfxBody = (prompt, durationSec) => ({
  text: prompt,
  duration_seconds: durationSec,
  model_id: 'eleven_text_to_sound_v2',
});

export const parseFfprobeDuration = (text) => {
  const m = text.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d{2})/);
  if (!m) return null;
  const [, h, min, s, cs] = m.map(Number);
  return (h * 3600 + min * 60 + s) * 1000 + cs * 10;
};

export const redact = (text, secret) =>
  secret ? String(text).replaceAll(secret, '<redacted>') : String(text);

export const measureMs = (file) => {
  const proc = spawnSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', resolve(file),
  ], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  const seconds = Number(String(proc.stdout).trim());
  return proc.status === 0 && Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null;
};

const generate = async (url, body, key, timeout) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: {'xi-api-key': key, 'content-type': 'application/json'},
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ElevenLabs ${res.status}: ${text.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
};

// Same headers/error shape as generate(), but the with-timestamps endpoint answers
// JSON (base64 audio + char alignment) instead of binary mp3.
const generateJson = async (url, body, key, timeout) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: {'xi-api-key': key, 'content-type': 'application/json'},
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ElevenLabs ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
};

// Per-brand voice override: ELEVENLABS_VOICE_ID_<BRAND> (brand id uppercased,
// dashes -> underscores) beats the global ELEVENLABS_VOICE_ID, which beats
// DEFAULT_VOICE. `brand` is optional; omitting it reproduces the old
// global-only lookup exactly.
export const resolveVoiceId = (env, brand) => {
  if (brand) {
    const key = `ELEVENLABS_VOICE_ID_${brand.toUpperCase().replaceAll('-', '_')}`;
    if (env[key]) return {voice: env[key], source: `brand env (${key})`};
  }
  if (env.ELEVENLABS_VOICE_ID) {
    return {voice: env.ELEVENLABS_VOICE_ID, source: 'global env (ELEVENLABS_VOICE_ID)'};
  }
  return {voice: DEFAULT_VOICE, source: 'default'};
};

const argValue = (args, flag) => {
  const i = args.indexOf(flag);
  if (i < 0 || i === args.length - 1) return null;
  return args[i + 1];
};

// no API call: just resolves and validates the --file arg, so this is unit-testable
// without spawning ffprobe.
export const resolveProbeFile = (args) => {
  const file = argValue(args, '--file');
  if (!file) throw new Error('probe requires --file <mp3>');
  return file;
};

// Same no-API-call contract as resolveProbeFile, for the `words` fallback mode.
export const resolveWordsArgs = (args) => {
  const file = argValue(args, '--file');
  const text = argValue(args, '--text');
  const out = argValue(args, '--out');
  if (!file || !text || !out) throw new Error('words requires --file, --text, --out');
  return {file, text, out};
};

const main = async () => {
  const args = process.argv.slice(2);
  const mode = args[0];
  const brand = argValue(args, '--brand') ?? 'audio';
  const productWorkspace = () => {
    const project = projectArg(args);
    if (!project) throw new Error(`${mode} requires --project <product-repo>`);
    return resolveWorkspace(ROOT, {brand, project});
  };

  if (mode === 'probe') {
    try {
      const file = resolveProbeFile(args);
      const ms = measureMs(file);
      if (!ms) throw new Error(`could not measure duration of ${file}`);
      console.log(`probe OK: ${file} ${ms}ms`);
    } catch (err) {
      console.error(String(err?.message ?? err));
      process.exit(1);
    }
    return;
  }

  // No-regeneration fallback: derive word times from an mp3 already on disk. Like
  // `probe`, it needs no API key, so it sits before the key check.
  if (mode === 'words') {
    try {
      const {file, text, out} = resolveWordsArgs(args);
      const workspace = productWorkspace();
      const inputFile = resolveWorkspacePath(workspace, file);
      const outFile = resolveWorkspacePath(workspace, out);
      const durationMs = measureMs(inputFile);
      if (!durationMs) throw new Error(`could not measure duration of ${file}`);
      const words = estimateWords(text, durationMs);
      const payload = {
        id: basename(inputFile, '.mp3'),
        text,
        durationMs,
        words,
        estimated: true,
      };
      mkdirSync(dirname(outFile), {recursive: true});
      writeFileSync(outFile, JSON.stringify(payload, null, 2) + '\n');
      console.log(`words OK: ${outFile} ${words.length} words ${durationMs}ms (estimated)`);
    } catch (err) {
      console.error(String(err?.message ?? err));
      process.exit(1);
    }
    return;
  }

  const env = process.env;
  const key = env.ELEVENLABS_API_KEY;
  if (!key) {
    console.error(
      'ELEVENLABS_API_KEY not set in .env; videos render silent (documented fallback). Add the key and re-run.',
    );
    process.exit(2);
  }
  const {voice, source} = resolveVoiceId(env, brand);
  console.log(`voice source: ${source}`);

  try {
    if (mode === 'vo') {
      const scriptPath = argValue(args, '--script');
      const outDir = argValue(args, '--out');
      if (!scriptPath || !outDir) throw new Error('vo requires --script and --out');
      const workspace = productWorkspace();
      const scriptFile = resolveWorkspacePath(workspace, scriptPath);
      const outputDir = resolveWorkspacePath(workspace, outDir);
      const wantTimestamps = args.includes('--timestamps');
      const script = JSON.parse(readFileSync(scriptFile, 'utf8'));
      mkdirSync(outputDir, {recursive: true});
      for (const line of script.lines) {
        const dest = join(outputDir, `${line.id}.mp3`);
        let words = null;
        if (wantTimestamps) {
          // Same model as the plain path: a model change re-times every word.
          const json = await generateJson(
            buildTtsTimestampsUrl(voice),
            {text: line.text, model_id: 'eleven_multilingual_v2'},
            key,
            TTS_TIMEOUT,
          );
          writeFileSync(dest, Buffer.from(json.audio_base64, 'base64'));
          words = aggregateWords(json.alignment, line.text);
        } else {
          const bytes = await generate(
            buildTtsUrl(voice),
            {text: line.text, model_id: 'eleven_multilingual_v2'},
            key,
            TTS_TIMEOUT,
          );
          writeFileSync(dest, bytes);
        }
        const ms = measureMs(dest);
        if (!ms) throw new Error(`could not measure duration of ${line.id}.mp3`);
        if (words) {
          writeFileSync(
            join(outputDir, `${line.id}.words.json`),
            JSON.stringify(
              {id: line.id, text: line.text, durationMs: ms, words, estimated: false},
              null,
              2,
            ) + '\n',
          );
        }
        // The builders match /vo OK: (.+)\.mp3 (\d+)ms/ — do not reorder those two fields.
        console.log(`vo OK: ${line.id}.mp3 ${ms}ms${words ? ` words=${words.length}` : ''}`);
      }
    } else if (mode === 'music') {
      const prompt = argValue(args, '--prompt');
      const lengthMs = Number(argValue(args, '--length-ms'));
      const outFile = argValue(args, '--out');
      if (!prompt || !Number.isFinite(lengthMs) || lengthMs <= 0 || !outFile)
        throw new Error('music requires --prompt, --length-ms > 0, --out');
      const outputFile = resolveWorkspacePath(productWorkspace(), outFile);
      const bytes = await generate(`${API}/v1/music?output_format=mp3_44100_128`, buildMusicBody(prompt, Math.round(lengthMs)), key, MUSIC_TIMEOUT);
      mkdirSync(dirname(outputFile), {recursive: true});
      writeFileSync(outputFile, bytes);
      const ms = measureMs(outputFile);
      if (!ms) throw new Error(`could not measure duration of ${outFile}`);
      console.log(`music OK: ${outputFile} ${ms}ms`);
    } else if (mode === 'sfx') {
      const prompt = argValue(args, '--prompt');
      const durationSec = Number(argValue(args, '--duration-sec'));
      const outFile = argValue(args, '--out');
      if (!prompt || !Number.isFinite(durationSec) || durationSec <= 0 || !outFile)
        throw new Error('sfx requires --prompt, --duration-sec > 0, --out');
      const outputFile = resolveWorkspacePath(productWorkspace(), outFile);
      // The cue layer is a non-essential accent: if sound-generation is unavailable
      // on this plan/account or errors for any reason, fall back SILENTLY (exit 2, the
      // repo's documented missing-audio convention) instead of hard-failing the run.
      let bytes;
      try {
        bytes = await generate(
          `${API}/v1/sound-generation?output_format=mp3_44100_128`,
          buildSfxBody(prompt, durationSec),
          key,
          SFX_TIMEOUT,
        );
      } catch (err) {
        console.error(
          `sound-generation unavailable (${redact(err?.message ?? String(err), key)}); skipping sfx (silent fallback).`,
        );
        process.exit(2);
      }
      mkdirSync(dirname(outputFile), {recursive: true});
      writeFileSync(outputFile, bytes);
      const ms = measureMs(outputFile);
      if (!ms) throw new Error(`could not measure duration of ${outFile}`);
      console.log(`sfx OK: ${outputFile} ${ms}ms`);
    } else {
      throw new Error('usage: client.mjs vo --script <json> --out <dir> [--timestamps] [--brand <id>] | music --prompt <p> --length-ms <n> --out <file> | sfx --prompt <p> --duration-sec <n> --out <file> | probe --file <mp3> | words --file <mp3> --text "<spoken text>" --out <words.json>');
    }
  } catch (err) {
    console.error(redact(err?.message ?? String(err), key));
    process.exit(1);
  }
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
