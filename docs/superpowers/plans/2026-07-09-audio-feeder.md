# Audio Feeder + Remotion Audio Implementation Plan

> **Historical note:** this plan predates the later slim of the studio to
> synthacon-only. References to noban, dashclaw, or paperroute below are
> historical and describe brands that have since been removed from the repo.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ElevenLabs voiceover + music feeder, an audio manifest contract, ducking math, a SoundTrack component wired into LaunchVideo, the noban audio build, and the audio-track user skill — ending with the launch video re-rendered with sound for user approval.

**Architecture:** Per `docs/superpowers/specs/2026-07-09-audio-feeder-design.md`. A dependency-free Node client (comfy-client pattern) generates per-line VO mp3s and an exact-length music track, measuring real durations via Remotion's bundled ffprobe. A build script per brand is the copy source of truth and emits the manifest `props/<brand>-audio.json`. Pure ducking math lives in `studio/src/lib/audioMix.ts` (vitest); `SoundTrack` renders music with the ducked volume curve plus sequenced VO; `LaunchVideo` takes a nullable `audio` prop (null = today's silent behavior, smoke-safe).

**Tech Stack:** Node 18+ fetch + node:test (feeder), Remotion `<Audio>` (core, no new deps), vitest, ElevenLabs REST (verified endpoints in the spec).

## Global Constraints

- Verified API (do not re-derive): TTS `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128` body `{"text","model_id":"eleven_multilingual_v2"}`; Music `POST https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128` body `{"prompt","music_length_ms","model_id":"music_v2"}`; header `xi-api-key`. Key from repo `.env` `ELEVENLABS_API_KEY` (already set); voice `ELEVENLABS_VOICE_ID` default `21m00Tcm4TlvDq8ikWAM`. NEVER print or commit the key; redact it from all error text; never Read .env into a report.
- Exit codes: 2 = missing key (non-load-bearing fallback, actionable message); 1 = reachable-but-failed. Fetch timeouts: 60s TTS, 300s music.
- Ducking constants (spec): base 0.35, ducked 0.12, ramp 9 frames, VO lead 12 frames, master fade-in 24, fade-out 36, fps 30. VO windows clamp to their act for DUCKING; the `<Audio>` itself plays its full clip.
- Audio files -> `studio/public/<brand>/audio/` (gitignored); manifest `props/<brand>-audio.json` committed, generated only by its build script.
- `audio: null` must render byte-identically to today; smoke (6 comps) + 22 vitest + lint stay green.
- **Concurrency note:** another session may have uncommitted or freshly-committed changes in `studio/src` (fonts are now per-brand: `loadBrandFonts(brand)`). Before touching any studio file, read its CURRENT contents and make anchored, minimal insertions; never restore an older version of surrounding code. If `git status` shows uncommitted studio changes from another session, STOP and ask the controller.
- Copy: no em dashes, no hype. VO text is written to be SPOKEN (e.g. "noban dot gg", not "noban.gg").

## File Structure (end state)

```
feeders/audio/
├── client.mjs            # vo + music commands, ffprobe measurement (Task 1)
└── client.test.mjs       # node:test for pure helpers (Task 1)
studio/src/lib/audioMix.ts        # audioSchema + voWindows + duckedVolume (Task 2)
studio/src/lib/audioMix.test.ts   # vitest (Task 2)
studio/src/components/SoundTrack.tsx  # music + VO playback (Task 3)
studio/src/templates/LaunchVideo.tsx  # + audio prop (Task 3, anchored edits)
studio/src/Root.tsx                   # defaultProps audio: null (Task 3)
scripts/build-noban-audio.mjs     # copy source of truth -> manifest (Task 4)
props/noban-audio.json            # generated manifest (Task 4)
README.md, docs/PLAYBOOK.md       # audio docs (Task 5)
~/.claude/skills/audio-track/SKILL.md  # user skill (Task 5)
```

---

### Task 1: Audio feeder client (`feeders/audio/client.mjs`)

**Files:**
- Create: `feeders/audio/client.mjs`
- Test: `feeders/audio/client.test.mjs`

**Interfaces:**
- Produces:
  - CLI `node feeders/audio/client.mjs vo --script <json> --out <dir>` — script shape `{lines: [{id: string, text: string}]}`; writes `<out>/<id>.mp3` per line and prints `vo OK: <id>.mp3 <durationMs>ms` per line.
  - CLI `node feeders/audio/client.mjs music --prompt "<text>" --length-ms <n> --out <file>` — prints `music OK: <file> <durationMs>ms`.
  - Pure helpers (exported, unit tested): `buildTtsUrl(voiceId: string): string`, `buildMusicBody(prompt: string, lengthMs: number): object`, `parseFfprobeDuration(text: string): number | null` (ms), `redact(text: string, secret: string): string`.
  - Duration lines on stdout are the machine-readable contract Task 4 parses: `/(vo|music) OK: (.+) (\d+)ms/`.

- [ ] **Step 1: Write the failing test** — `feeders/audio/client.test.mjs`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTtsUrl, buildMusicBody, parseFfprobeDuration, redact} from './client.mjs';

test('buildTtsUrl embeds the voice id and mp3 output format', () => {
  assert.equal(
    buildTtsUrl('21m00Tcm4TlvDq8ikWAM'),
    'https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM?output_format=mp3_44100_128',
  );
});

test('buildMusicBody carries prompt, length, and the music_v2 model', () => {
  assert.deepEqual(buildMusicBody('dark pulse', 45100), {
    prompt: 'dark pulse',
    music_length_ms: 45100,
    model_id: 'music_v2',
  });
});

test('parseFfprobeDuration reads HH:MM:SS.cc into ms', () => {
  const out = 'Input #0, mp3\n  Duration: 00:00:45.12, start: 0.02, bitrate: 128 kb/s';
  assert.equal(parseFfprobeDuration(out), 45120);
  assert.equal(parseFfprobeDuration('Duration: 00:01:02.50,'), 62500);
  assert.equal(parseFfprobeDuration('no duration here'), null);
});

test('redact strips the secret from arbitrary text', () => {
  assert.equal(redact('boom sk_123 happened', 'sk_123'), 'boom <redacted> happened');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Projects/animations/feeders/audio && node --test client.test.mjs`
Expected: FAIL — cannot find module './client.mjs'.

- [ ] **Step 3: Write `feeders/audio/client.mjs`**

```js
#!/usr/bin/env node
/**
 * ElevenLabs audio feeder: voiceover lines and exact-length music tracks.
 * NON-LOAD-BEARING: missing key exits 2 with guidance; videos render silent.
 *
 * Usage:
 *   node feeders/audio/client.mjs vo --script <script.json> --out <dir>
 *   node feeders/audio/client.mjs music --prompt "<text>" --length-ms <n> --out <file>
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

export const buildTtsUrl = (voiceId) =>
  `${API}/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;

export const buildMusicBody = (prompt, lengthMs) => ({
  prompt,
  music_length_ms: lengthMs,
  model_id: 'music_v2',
});

export const parseFfprobeDuration = (text) => {
  const m = text.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
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

const measureMs = (file) => {
  // remotion bundles ffprobe; it prints stream info (incl. Duration) to stderr
  const proc = spawnSync('npx', ['remotion', 'ffprobe', resolve(file)], {
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

const main = async () => {
  const args = process.argv.slice(2);
  const mode = args[0];
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
    } else {
      throw new Error('usage: client.mjs vo --script <json> --out <dir> | music --prompt <p> --length-ms <n> --out <file>');
    }
  } catch (err) {
    console.error(redact(err?.message ?? String(err), key));
    process.exit(1);
  }
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/Projects/animations/feeders/audio && node --test client.test.mjs`
Expected: 4 tests PASS.

- [ ] **Step 5: Smoke the error paths** (do NOT hit the API in this task)

```bash
cd /c/Projects/animations
node feeders/audio/client.mjs vo --out /tmp/x; echo "exit=$?"     # missing --script -> exit 1, usage-ish error
node feeders/audio/client.mjs bogus; echo "exit=$?"                # unknown mode -> exit 1
```

(The key exists, so exit-2 cannot be smoke-tested without touching `.env` — do not touch it; the code path is 6 lines, reviewed instead.)

- [ ] **Step 6: Commit**

```bash
git add feeders/audio/client.mjs feeders/audio/client.test.mjs
git commit -m "feat: ElevenLabs audio feeder with duration measurement"
```

---

### Task 2: Ducking math + manifest schema (`studio/src/lib/audioMix.ts`)

**Files:**
- Create: `studio/src/lib/audioMix.ts`
- Test: `studio/src/lib/audioMix.test.ts`

**Interfaces:**
- Consumes: `launchTiming` act shape `{from: number; len: number}` (existing `lib/launchTiming.ts`).
- Produces (used by Task 3):
  - `audioSchema = z.object({music: z.object({src: z.string(), durationMs: z.number().positive()}).nullable(), lines: z.array(z.object({act: z.string(), src: z.string(), durationMs: z.number().positive(), text: z.string()}))})`; `type AudioManifest = z.infer<typeof audioSchema>`.
  - `voWindows(lines: AudioManifest['lines'], timing: {logo: Act; hook: Act; demo: Act; features: Act[]; end: Act}): {fromFrame: number; toFrame: number; src: string}[]` — act key `logo|hook|demo|end` or `feature-<n>`; window from = act.from + 12, to = min(from + ceil(durationMs/1000*30), act.from + act.len); unknown act keys THROW (loud manifest errors).
  - `duckedVolume(frame: number, windows: {fromFrame: number; toFrame: number}[], totalFrames: number): number` — base 0.35, 0.12 inside windows, linear 9-frame ramps on both edges, multiplied by master fade-in over frames 0-24 and fade-out over the last 36 frames.

- [ ] **Step 1: Write the failing test** — `studio/src/lib/audioMix.test.ts`

```ts
import {describe, expect, it} from 'vitest';
import {audioSchema, voWindows, duckedVolume} from './audioMix';

const TIMING = {
  logo: {from: 0, len: 150},
  hook: {from: 150, len: 186},
  demo: {from: 336, len: 504},
  features: [{from: 840, len: 180}, {from: 1020, len: 180}],
  end: {from: 1200, len: 150},
};

describe('audioSchema', () => {
  it('accepts a manifest and null music', () => {
    const m = audioSchema.parse({
      music: null,
      lines: [{act: 'hook', src: 'noban/audio/hook.mp3', durationMs: 3900, text: 'x'}],
    });
    expect(m.lines).toHaveLength(1);
  });
});

describe('voWindows', () => {
  it('maps act keys to frame windows with the 12-frame lead', () => {
    const w = voWindows(
      [
        {act: 'hook', src: 'a', durationMs: 4000, text: ''},
        {act: 'feature-1', src: 'b', durationMs: 3000, text: ''},
      ],
      TIMING,
    );
    expect(w[0]).toEqual({fromFrame: 162, toFrame: 282, src: 'a'}); // 150+12 .. +ceil(4*30)
    expect(w[1].fromFrame).toBe(1032);
  });

  it('clamps the ducking window to the act end', () => {
    const w = voWindows([{act: 'end', src: 'c', durationMs: 60000, text: ''}], TIMING);
    expect(w[0].toFrame).toBe(1350); // end.from + end.len
  });

  it('throws on unknown act keys', () => {
    expect(() => voWindows([{act: 'outro', src: 'd', durationMs: 1000, text: ''}], TIMING)).toThrow(/outro/);
  });
});

describe('duckedVolume', () => {
  const W = [{fromFrame: 300, toFrame: 400}];
  it('sits at base volume away from windows (after fade-in)', () => {
    expect(duckedVolume(200, W, 1350)).toBeCloseTo(0.35, 5);
  });
  it('ducks inside a window', () => {
    expect(duckedVolume(350, W, 1350)).toBeCloseTo(0.12, 5);
  });
  it('ramps linearly at the window edge', () => {
    const v = duckedVolume(296, W, 1350); // 4 frames into the 9-frame approach (300-9=291)
    expect(v).toBeLessThan(0.35);
    expect(v).toBeGreaterThan(0.12);
  });
  it('applies master fades at the ends', () => {
    expect(duckedVolume(0, [], 1350)).toBe(0);
    expect(duckedVolume(12, [], 1350)).toBeCloseTo(0.175, 3); // half of fade-in
    expect(duckedVolume(1349, [], 1350)).toBeCloseTo(0, 2);
  });
  it('is base volume with no windows mid-video', () => {
    expect(duckedVolume(700, [], 1350)).toBeCloseTo(0.35, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Projects/animations/studio && npm test`
Expected: FAIL — cannot resolve `./audioMix`.

- [ ] **Step 3: Write `studio/src/lib/audioMix.ts`**

```ts
import {z} from 'zod';

export const audioSchema = z.object({
  music: z.object({src: z.string(), durationMs: z.number().positive()}).nullable(),
  lines: z.array(
    z.object({
      act: z.string(),
      src: z.string(),
      durationMs: z.number().positive(),
      text: z.string(),
    }),
  ),
});

export type AudioManifest = z.infer<typeof audioSchema>;

type Act = {from: number; len: number};
type Timing = {logo: Act; hook: Act; demo: Act; features: Act[]; end: Act};

const FPS = 30;
const VO_LEAD = 12;
const BASE = 0.35;
const DUCKED = 0.12;
const RAMP = 9;
const FADE_IN = 24;
const FADE_OUT = 36;

const actFor = (key: string, timing: Timing): Act => {
  if (key === 'logo' || key === 'hook' || key === 'demo' || key === 'end') return timing[key];
  const m = key.match(/^feature-(\d+)$/);
  if (m && timing.features[Number(m[1])]) return timing.features[Number(m[1])];
  throw new Error(`audio manifest references unknown act "${key}"`);
};

export const voWindows = (
  lines: AudioManifest['lines'],
  timing: Timing,
): {fromFrame: number; toFrame: number; src: string}[] =>
  lines.map((line) => {
    const act = actFor(line.act, timing);
    const fromFrame = act.from + VO_LEAD;
    const toFrame = Math.min(
      fromFrame + Math.ceil((line.durationMs / 1000) * FPS),
      act.from + act.len,
    );
    return {fromFrame, toFrame, src: line.src};
  });

export const duckedVolume = (
  frame: number,
  windows: {fromFrame: number; toFrame: number}[],
  totalFrames: number,
): number => {
  // duck factor: 1 fully inside a window, 0 outside, linear over RAMP frames
  let duck = 0;
  for (const w of windows) {
    if (frame < w.fromFrame - RAMP || frame > w.toFrame + RAMP) continue;
    let d = 1;
    if (frame < w.fromFrame) d = (frame - (w.fromFrame - RAMP)) / RAMP;
    else if (frame > w.toFrame) d = ((w.toFrame + RAMP) - frame) / RAMP;
    duck = Math.max(duck, Math.min(1, Math.max(0, d)));
  }
  const level = BASE - (BASE - DUCKED) * duck;
  const fadeIn = Math.min(1, frame / FADE_IN);
  const fadeOut = Math.min(1, (totalFrames - 1 - frame) / FADE_OUT);
  return level * Math.max(0, fadeIn) * Math.max(0, fadeOut);
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/Projects/animations/studio && npm test`
Expected: all pass (22 existing + 9 new = 31).

- [ ] **Step 5: Commit**

```bash
git add studio/src/lib/audioMix.ts studio/src/lib/audioMix.test.ts
git commit -m "feat: audio manifest schema and ducking math"
```

---

### Task 3: SoundTrack component + LaunchVideo wiring (ANCHORED EDITS)

**Files:**
- Create: `studio/src/components/SoundTrack.tsx`
- Modify: `studio/src/templates/LaunchVideo.tsx` (anchored insertions — READ the current file first; it changed recently)
- Modify: `studio/src/Root.tsx` (LaunchVideo defaultProps gain `audio: null`)

**Interfaces:**
- Consumes: `audioSchema`, `AudioManifest`, `voWindows`, `duckedVolume` (Task 2); `launchTiming` return value (existing).
- Produces: `SoundTrack: React.FC<{audio: AudioManifest; timing: Parameters<typeof voWindows>[1]}>`; `launchVideoSchema` gains `audio: audioSchema.nullable()`.

- [ ] **Step 1: Write `studio/src/components/SoundTrack.tsx`**

```tsx
import React from 'react';
import {Audio, Sequence, staticFile, useVideoConfig} from 'remotion';
import type {AudioManifest} from '../lib/audioMix';
import {duckedVolume, voWindows} from '../lib/audioMix';

export const SoundTrack: React.FC<{
  audio: AudioManifest;
  timing: Parameters<typeof voWindows>[1];
}> = ({audio, timing}) => {
  const {durationInFrames} = useVideoConfig();
  const windows = voWindows(audio.lines, timing);
  return (
    <>
      {audio.music ? (
        <Audio
          src={staticFile(audio.music.src)}
          volume={(f) => duckedVolume(f, windows, durationInFrames)}
        />
      ) : null}
      {windows.map((w, i) => (
        <Sequence key={i} from={w.fromFrame}>
          <Audio src={staticFile(w.src)} />
        </Sequence>
      ))}
    </>
  );
};
```

- [ ] **Step 2: Anchored edits to `studio/src/templates/LaunchVideo.tsx`**

READ the file first (concurrent sessions have modified it; fonts now resolve via
`loadBrandFonts(brand)`). Make exactly these insertions, adapting to surrounding code:

1. Imports: `import {audioSchema} from '../lib/audioMix';` and `import {SoundTrack} from '../components/SoundTrack';`
2. Schema: add `audio: audioSchema.nullable(),` to `launchVideoSchema`.
3. Component props: destructure `audio` alongside the existing props.
4. Render: inside the root `<AbsoluteFill>`, after the act `<Sequence>` blocks and
   before the FloatBar div, add:

```tsx
      {audio ? <SoundTrack audio={audio} timing={t} /> : null}
```

(`t` is the existing `launchTiming(...)` result already in scope.)

- [ ] **Step 3: `studio/src/Root.tsx`** — add `audio: null,` to LaunchVideo's `defaultProps` (read current file; anchored insertion).

- [ ] **Step 4: Verify silent behavior unchanged + suite green**

```bash
cd /c/Projects/animations/studio && npm test && npm run lint
cd /c/Projects/animations && node scripts/smoke.mjs   # smoke OK: 6 compositions
cd studio && npx remotion still LaunchVideo ../out/smoke/audio-null-check.png --frame=200 --props=../props/noban-launch.json
```

The still must match the pre-change look (headline act; `audio` absent from the props file parses as... NOTE: `audio` is nullable but NOT optional — zod requires the key. Make it `audio: audioSchema.nullable().optional().default(null)` if the existing `props/noban-launch.json` (no audio key) fails to parse; prefer `.nullable().default(null)` so old props files stay valid. Verify by running the still command above against the UNMODIFIED props file — it must render.)

- [ ] **Step 5: Commit**

```bash
git add studio/src/components/SoundTrack.tsx studio/src/templates/LaunchVideo.tsx studio/src/Root.tsx
git commit -m "feat: SoundTrack component and optional LaunchVideo audio"
```

---

### Task 4: noban audio build (LIVE generation) + manifest

**Files:**
- Create: `scripts/build-noban-audio.mjs`
- Create (generated, committed): `props/noban-audio.json`
- Generated (gitignored): `studio/public/noban/audio/*.mp3`

**Interfaces:**
- Consumes: feeder CLI + its `(vo|music) OK: <name> <ms>ms` stdout contract (Task 1); `props/noban-demo.json` telemetry (for total duration); `launchTiming` constants (duplicated arithmetic is FORBIDDEN — compute total by running `node -e` against the studio lib is overkill; instead: total frames = 150+186+(ceil(telemetry.durationMs/1000*30)+24)+2*180+150, matching lib/launchTiming.ts constants; add a comment pointing at that file as the source).
- Produces: `props/noban-audio.json` matching `audioSchema` with acts `logo|hook|demo|feature-0|feature-1|end`.

- [ ] **Step 1: Write `scripts/build-noban-audio.mjs`**

```js
// Source of truth for noban launch AUDIO copy: props/noban-audio.json is GENERATED.
// Edit VO lines and the music prompt here, never in the JSON.
import {execSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'studio', 'public', 'noban', 'audio');
const force = process.argv.includes('--force');

// Spoken copy: written for the ear (say "noban dot gg", never "noban.gg")
const LINES = [
  {id: 'logo', text: 'This is noban. CS2 skin arbitrage with guardrails.'},
  {id: 'hook', text: 'It finds the spread. You keep the profit. The guardrails keep you honest.'},
  {id: 'demo', text: 'The trading desk scans nine venues live, ranks every opportunity by net dollars, and books each simulated trade to the ledger.'},
  {id: 'feature-0', text: 'Hard spend caps and a kill switch, enforced in the backend.'},
  {id: 'feature-1', text: 'Cost basis, realized gains, and a tax worksheet your accountant can read.'},
  {id: 'end', text: 'Simulate free at noban dot gg.'},
];

const MUSIC_PROMPT =
  'minimal dark electronic pulse, restrained analog synths, steady confident tempo around 100 bpm, precise and instrument-like, understated build, no vocals';

// total duration in ms; constants mirror studio/src/lib/launchTiming.ts
const telemetry = JSON.parse(readFileSync(join(root, 'props', 'noban-demo.json'), 'utf8')).telemetry;
const demoLen = Math.ceil((telemetry.durationMs / 1000) * 30) + 24;
const totalFrames = 150 + 186 + demoLen + 2 * 180 + 150;
const totalMs = Math.round((totalFrames / 30) * 1000);

mkdirSync(outDir, {recursive: true});
const durations = {};

const run = (cmd) => execSync(cmd, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']});

// VO: generate missing lines (all lines when --force)
const pending = LINES.filter((l) => force || !existsSync(join(outDir, `${l.id}.mp3`)));
if (pending.length > 0) {
  const scriptPath = join(root, 'out', 'noban', 'vo-script.json');
  mkdirSync(dirname(scriptPath), {recursive: true});
  writeFileSync(scriptPath, JSON.stringify({lines: pending}));
  const out = run(`node feeders/audio/client.mjs vo --script "${scriptPath}" --out "${outDir}"`);
  process.stdout.write(out);
  for (const m of out.matchAll(/vo OK: (.+)\.mp3 (\d+)ms/g)) durations[m[1]] = Number(m[2]);
}
// measure any already-present lines we skipped
for (const l of LINES) {
  if (durations[l.id]) continue;
  const probe = run(`node feeders/audio/client.mjs vo --script nul --out nul 2>&1 || true`); // placeholder never executed; see below
}

const musicFile = join(outDir, 'music.mp3');
if (force || !existsSync(musicFile)) {
  const out = run(
    `node feeders/audio/client.mjs music --prompt "${MUSIC_PROMPT}" --length-ms ${totalMs} --out "${musicFile}"`,
  );
  process.stdout.write(out);
  const m = out.match(/music OK: .+ (\d+)ms/);
  durations.music = Number(m?.[1]);
}

// NOTE FOR IMPLEMENTER: the skip-path measurement above is wrong as sketched —
// replace it with a small `measure` helper in the feeder: add a third CLI mode
// `probe --file <mp3>` printing `probe OK: <file> <ms>ms`, and call it here for
// any line/music file whose duration was not captured this run. Keep the plan's
// stdout contract. (This is the one intentional deviation delegated to the
// implementer; wire it cleanly rather than duplicating ffprobe logic here.)

const manifest = {
  music: durations.music ? {src: 'noban/audio/music.mp3', durationMs: durations.music} : null,
  lines: LINES.map((l) => ({
    act: l.id,
    src: `noban/audio/${l.id}.mp3`,
    durationMs: durations[l.id],
    text: l.text,
  })),
};
writeFileSync(join(root, 'props', 'noban-audio.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote props/noban-audio.json (${totalMs}ms track, ${LINES.length} lines)`);
```

Implementer note (binding): add the `probe --file <mp3>` mode to `feeders/audio/client.mjs`
(prints `probe OK: <file> <ms>ms`, no API call, exit 1 if unmeasurable) with a unit test
for its arg handling, and use it in this script for skipped files. Delete the placeholder
loop above.

- [ ] **Step 2: Run it live** (key is present; TTS costs cents, music uses credits; music can take 1-3 min)

```bash
cd /c/Projects/animations && node scripts/build-noban-audio.mjs
```

Expected: 6 `vo OK` lines + 1 `music OK` + manifest written. Sanity: every
`durationMs` > 0; music duration within ~2s of the requested total; each VO line's
duration comfortably under its act length (logo 5s, hook 6.2s, demo 16.8s,
features 6s, end 5s) — if a line overruns, shorten ITS TEXT here and re-run with
`--force` for that workflow (acceptable: trim copy, never squeeze timing).

- [ ] **Step 3: Validate the manifest against the schema**

```bash
cd studio && node -e "
const {audioSchema} = require('./node_modules/.cache/never'); // placeholder
"
```

Implementer note (binding): validate by rendering instead — schema validation happens
at composition parse. Run:
`npx remotion still LaunchVideo ../out/smoke/audio-still.png --frame=200 --props=<merged>`
where `<merged>` is a temp JSON of `props/noban-launch.json` + `"audio": <contents of props/noban-audio.json>`
(write it with a 3-line node script into `out/noban/launch-audio-props.json` — and keep
that merge script as `scripts/merge-launch-audio.mjs` since Task 5 and every future
render needs it: it reads both props files and writes the merged one).

- [ ] **Step 4: Commit**

```bash
git add scripts/build-noban-audio.mjs scripts/merge-launch-audio.mjs props/noban-audio.json feeders/audio/client.mjs feeders/audio/client.test.mjs
git commit -m "feat: noban launch audio build with generated manifest"
```

---

### Task 5: Audible render + docs + audio-track skill (exit criterion)

**Files:**
- Modify: `README.md`, `docs/PLAYBOOK.md`
- Create: `~/.claude/skills/audio-track/SKILL.md`
- Modify: `~/.claude/skills/launch-video/SKILL.md` (cross-reference)
- Generated: `out/noban/launch-audio.mp4`

- [ ] **Step 1: Render the launch video with audio**

```bash
cd /c/Projects/animations && node scripts/merge-launch-audio.mjs
cd studio && npx remotion render LaunchVideo ../out/noban/launch-audio.mp4 --props=../out/noban/launch-audio-props.json
```

Expected: exits 0; file several MB. Verify the mp4 HAS an audio stream:
`npx remotion ffprobe ../out/noban/launch-audio.mp4 2>&1 | grep -i audio` shows an mp3/aac stream.

- [ ] **Step 2: README** — under Render add:

```markdown
    node scripts/build-noban-audio.mjs        # generate VO + music (needs ELEVENLABS_API_KEY in .env)
    node scripts/merge-launch-audio.mjs       # merge audio manifest into launch props
    npx remotion render LaunchVideo ../out/noban/launch-audio.mp4 --props=../out/noban/launch-audio-props.json
```

- [ ] **Step 3: PLAYBOOK** — add an `### Audio (ElevenLabs feeder)` subsection under
the gotchas: verified endpoints (from the spec), ducking constants and where they
live, the manifest contract + `probe` mode, "VO text is written for the ear",
"trim copy rather than squeeze timing", credit-cost note (TTS cents per video,
music per-generation credits), and the fallback behavior (missing key exit 2 =
silent video, still valid).

- [ ] **Step 4: Write `~/.claude/skills/audio-track/SKILL.md`**

```markdown
---
name: audio-track
description: Use when the user wants music, voiceover, narration, or a soundtrack added to a video asset (e.g. "/audio-track", "add music to the launch video", "narrate the demo").
---

# Audio Track

**REQUIRED BACKGROUND:** animation-studio skill. Work in `C:\Projects\animations`.
Read the PLAYBOOK's Audio section first (endpoints, ducking, manifest contract).

Produces: the target composition re-rendered with music + voiceover
(`out/<brand>/<asset>-audio.mp4`).

## Recipe

1. Shared-repo guard + toolchain per animation-studio. `ELEVENLABS_API_KEY` must be
   in the repo `.env` (missing key = the feeder exits 2 and videos stay silent).
2. Copy source of truth: `scripts/build-<brand>-audio.mjs` (copy the noban one for a
   new brand). VO lines are keyed by act, written FOR THE EAR ("dot gg", not ".gg"),
   one line per act, terse. Music prompt describes the brand's sonic character.
3. Run it: `node scripts/build-<brand>-audio.mjs` (music takes 1-3 min). Check every
   line's duration fits its act; trim TEXT if not, re-run with --force.
4. Merge + render: `node scripts/merge-launch-audio.mjs` then render the composition
   with the merged props.
5. Listen-proof: verify the mp4 has an audio stream (ffprobe), then SEND the video —
   audio is approved by ear, by the user. Ducking feel (base 0.35 / duck 0.12) is
   tunable in `studio/src/lib/audioMix.ts` if redlined.
```

- [ ] **Step 5: launch-video skill cross-reference** — add one line to its recipe:
`7. Audio: run the audio-track skill to add music + voiceover to the render.`

- [ ] **Step 6: Send `out/noban/launch-audio.mp4` for user review.** Exit criterion:
user approves by ear. Apply redlines (ducking constants, copy, music prompt seeds)
and re-render as needed.

- [ ] **Step 7: Commit**

```bash
git add README.md docs/PLAYBOOK.md
git commit -m "docs: audio pipeline run steps and playbook section"
```

---

## Self-Review Notes

- **Spec coverage:** feeder with both commands + measurement (T1, + probe mode via T4's binding note), manifest + ducking math (T2), SoundTrack + nullable LaunchVideo audio (T3), brand build script + live generation (T4), docs + skill + audible exit artifact (T5).
- **Type consistency:** `audioSchema`/`AudioManifest` identical T2-T4; `voWindows` timing param matches `launchTiming`'s return shape; stdout contract `(vo|music|probe) OK: <name> <ms>ms` consistent between T1/T4; act keys `logo|hook|demo|feature-N|end` consistent T2/T4.
- **Honest rough edges delegated with binding notes (not placeholders):** the `probe` CLI mode (T4 note — the plan's sketch marked the broken alternative FORBIDDEN-style and specifies the exact replacement), and the zod `.nullable().default(null)` fallback if old props files fail (T3 step 4 specifies the exact check and fix).
- **Concurrency:** every studio edit is anchored-read-first; global constraint tells implementers to stop if another session's uncommitted changes are present.
