#!/usr/bin/env node
/**
 * ElevenLabs audio feeder: voiceover lines and exact-length music tracks.
 * NON-LOAD-BEARING: missing key exits 2 with guidance; videos render silent.
 *
 * Usage:
 *   node feeders/audio/client.mjs vo --script <script.json> --out <dir>
 *   node feeders/audio/client.mjs music --prompt "<text>" --length-ms <n> --out <file>
 *   node feeders/audio/client.mjs sfx --prompt "<text>" --duration-sec <n> --out <file>
 *   node feeders/audio/client.mjs probe --file <mp3>
 */
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const API = 'https://api.elevenlabs.io';
const DEFAULT_VOICE = '21m00Tcm4TlvDq8ikWAM'; // Rachel (premade)
const TTS_TIMEOUT = 60_000;
const MUSIC_TIMEOUT = 300_000;
const SFX_TIMEOUT = 120_000;

export const buildTtsUrl = (voiceId) =>
  `${API}/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;

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

const readEnv = () => {
  const out = {};
  let raw;
  try {
    raw = readFileSync(join(ROOT, '.env'), 'utf8');
  } catch {
    return out;
  }
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (t && !t.startsWith('#') && t.includes('=')) {
      const i = t.indexOf('=');
      out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  }
  return out;
};

export const measureMs = (file) => {
  // remotion bundles ffprobe; it prints stream info (incl. Duration) to stderr
  const proc = spawnSync('npx', ['remotion', 'ffprobe', `"${resolve(file)}"`], {
    cwd: join(ROOT, 'studio'),
    shell: true,
    encoding: 'utf8',
    timeout: 60_000,
  });
  return parseFfprobeDuration(`${proc.stdout}\n${proc.stderr}`);
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

const main = async () => {
  const args = process.argv.slice(2);
  const mode = args[0];

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

  const env = readEnv();
  const key = env.ELEVENLABS_API_KEY;
  if (!key) {
    console.error(
      'ELEVENLABS_API_KEY not set in .env; videos render silent (documented fallback). Add the key and re-run.',
    );
    process.exit(2);
  }
  const voice = env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE;

  try {
    if (mode === 'vo') {
      const scriptPath = argValue(args, '--script');
      const outDir = argValue(args, '--out');
      if (!scriptPath || !outDir) throw new Error('vo requires --script and --out');
      const script = JSON.parse(readFileSync(resolve(scriptPath), 'utf8'));
      mkdirSync(resolve(outDir), {recursive: true});
      for (const line of script.lines) {
        const bytes = await generate(
          buildTtsUrl(voice),
          {text: line.text, model_id: 'eleven_multilingual_v2'},
          key,
          TTS_TIMEOUT,
        );
        const dest = join(resolve(outDir), `${line.id}.mp3`);
        writeFileSync(dest, bytes);
        const ms = measureMs(dest);
        if (!ms) throw new Error(`could not measure duration of ${line.id}.mp3`);
        console.log(`vo OK: ${line.id}.mp3 ${ms}ms`);
      }
    } else if (mode === 'music') {
      const prompt = argValue(args, '--prompt');
      const lengthMs = Number(argValue(args, '--length-ms'));
      const outFile = argValue(args, '--out');
      if (!prompt || !Number.isFinite(lengthMs) || lengthMs <= 0 || !outFile)
        throw new Error('music requires --prompt, --length-ms > 0, --out');
      const bytes = await generate(`${API}/v1/music?output_format=mp3_44100_128`, buildMusicBody(prompt, Math.round(lengthMs)), key, MUSIC_TIMEOUT);
      mkdirSync(dirname(resolve(outFile)), {recursive: true});
      writeFileSync(resolve(outFile), bytes);
      const ms = measureMs(outFile);
      if (!ms) throw new Error(`could not measure duration of ${outFile}`);
      console.log(`music OK: ${resolve(outFile)} ${ms}ms`);
    } else if (mode === 'sfx') {
      const prompt = argValue(args, '--prompt');
      const durationSec = Number(argValue(args, '--duration-sec'));
      const outFile = argValue(args, '--out');
      if (!prompt || !Number.isFinite(durationSec) || durationSec <= 0 || !outFile)
        throw new Error('sfx requires --prompt, --duration-sec > 0, --out');
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
      mkdirSync(dirname(resolve(outFile)), {recursive: true});
      writeFileSync(resolve(outFile), bytes);
      const ms = measureMs(outFile);
      if (!ms) throw new Error(`could not measure duration of ${outFile}`);
      console.log(`sfx OK: ${resolve(outFile)} ${ms}ms`);
    } else {
      throw new Error('usage: client.mjs vo --script <json> --out <dir> | music --prompt <p> --length-ms <n> --out <file> | sfx --prompt <p> --duration-sec <n> --out <file> | probe --file <mp3>');
    }
  } catch (err) {
    console.error(redact(err?.message ?? String(err), key));
    process.exit(1);
  }
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
