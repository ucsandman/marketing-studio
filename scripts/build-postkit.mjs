// Paste-ready post kit: assembles out/<brand>/postkit/{x,linkedin,tiktok,shorts,
// youtube,instagram}/ from artifacts already produced by render-matrix.mjs
// (video), extract-thumbs.mjs (thumbnail), build-captions.mjs (SRT/VTT), and
// out/<brand>/marketing/brief.json (platform copy, when the agent synthesized it).
//
// Usage: node scripts/build-postkit.mjs <brand>
//
// Each platform folder gets whatever of the following it can assemble (missing
// sources are a logged skip, not a failure):
//   - the right-aspect video, copied from out/<brand>/matrix/<id>.mp4
//   - the matching thumbnail, copied from out/<brand>/thumbs/thumb-<aspect>.(jpg|png)
//   - caption.txt — platform copy from brief.json's social block, else brand.tagline
//   - alt.txt — one-sentence literal description of the video content
//   - launch.srt/launch.vtt — copied in for youtube + linkedin only
//   - POST.md — human checklist: what to upload, which file, caption, notes
//
// WrapClip segment kits: for every out/<brand>/matrix/wrap-<segmentId>/ dir
// (render-matrix.mjs --comp WrapClip --props), an additional
// out/<brand>/postkit/wrap-<segmentId>/<platform>/ kit is assembled per platform
// with the segment's aspect-matched video (wrap-<aspect>.mp4), the same
// lint-gated brief-sourced caption.txt/alt.txt, and POST.md — no thumbnail or
// srt/vtt sidecars (those are launch-video artifacts). Brands without wrap dirs
// are completely unaffected.
//
// Also writes manifest.json at the kit root — machine-readable kit index
// consumed by launch-engine (plus a `segments` key when segment kits exist).
//
// caption.txt is gated by scripts/lint-copy.mjs (imported directly, not spawned):
// any ERROR-level violation FAILS the whole build. Exits non-zero only if NOTHING
// could be assembled across every platform; partial kits are the expected outcome
// before render-matrix.mjs has produced full videos.
import {copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {lintJson, formatReport} from './lint-copy.mjs';

// --- platform table ---------------------------------------------------------
// aspect matches extract-thumbs.mjs's thumb-<aspect>.jpg naming. videoSource is a
// matrix id from scripts/platforms.json (captioned variants use render-matrix.mjs's
// `${id}-captioned` naming). sourceKey is the brief.json social key this platform's
// caption pulls from (studio/src/lib/brief.ts: x | linkedin | vertical); null means
// the brief has no dedicated slot for this platform, so it always uses the tagline
// fallback. charBudget is each platform's public caption/description character limit.
export const PLATFORM_MAP = {
  x: {
    aspect: '16x9',
    videoSource: 'social-16x9',
    captionFile: false,
    charBudget: 280,
    sourceKey: 'x',
    note: 'Upload the video file directly to X. Do not link out to YouTube; X suppresses off-platform links in the feed.',
  },
  linkedin: {
    aspect: '16x9',
    videoSource: 'launch-16x9',
    captionFile: true,
    charBudget: 3000,
    sourceKey: 'linkedin',
    note: 'Upload the video natively to LinkedIn (native video outperforms a link post). Paste caption.txt as the post body.',
  },
  tiktok: {
    aspect: '9x16',
    videoSource: 'social-9x16-captioned',
    captionFile: false,
    charBudget: 2200,
    sourceKey: 'vertical',
    note: 'Upload as a TikTok video post. The video already has burned-in captions; paste caption.txt as the on-app caption/hashtag line.',
  },
  shorts: {
    aspect: '9x16',
    videoSource: 'social-9x16-captioned',
    captionFile: false,
    charBudget: 5000,
    sourceKey: 'vertical',
    note: 'Upload via YouTube Studio > Create > Upload video. Keep it vertical and under 60s so YouTube routes it to the Shorts shelf; paste caption.txt as the description.',
  },
  youtube: {
    aspect: '16x9',
    videoSource: 'launch-16x9',
    captionFile: true,
    charBudget: 5000,
    sourceKey: null,
    note: 'Upload as a standard YouTube video. Paste caption.txt as the description, then upload launch.srt or launch.vtt as captions in YouTube Studio.',
  },
  instagram: {
    aspect: '1x1',
    videoSource: 'social-1x1-captioned',
    captionFile: false,
    charBudget: 2200,
    sourceKey: 'vertical',
    note: 'Upload as an Instagram feed post or Reel. Paste caption.txt as the caption and alt.txt into Advanced settings > Accessibility > Alt text.',
  },
};

const PLATFORM_LABELS = {
  x: 'X',
  linkedin: 'LinkedIn',
  tiktok: 'TikTok',
  shorts: 'YouTube Shorts',
  youtube: 'YouTube',
  instagram: 'Instagram',
};

// --- pure helpers (unit-testable, no I/O) -----------------------------------

// Trims text to a char budget without cutting mid-word or adding an ellipsis
// (this repo's copy voice is terse and factual, not a hype flourish). Cuts at the
// last whitespace at or before the budget; if there is none (a single long
// "word"), hard-cuts at the budget.
export function trimToBudget(text, budget) {
  const trimmed = String(text ?? '').trim();
  if (trimmed.length <= budget) return trimmed;
  const cut = trimmed.slice(0, budget);
  const lastSpace = cut.lastIndexOf(' ');
  const safe = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return safe.trim();
}

// Platform copy for one postkit folder: brief.json's social block when the
// platform has a sourceKey and the brief provides that entry, else brand.tagline.
export function buildCaption(platformKey, brief, brand) {
  const cfg = PLATFORM_MAP[platformKey];
  const entry = cfg.sourceKey && brief?.social ? brief.social[cfg.sourceKey] : null;
  const raw = entry ? [entry.hook, entry.headline].filter(Boolean).join('\n\n') : brand.tagline;
  return trimToBudget(raw, cfg.charBudget);
}

// One-sentence literal description of the video content, for alt.txt.
export function buildAlt(brief, brand) {
  const headline = brief?.hook || brand.tagline;
  return `${brand.name} launch video: ${headline}.`;
}

// alt.txt for wrap segment kits: same brief-sourced fields as buildAlt, neutral
// wording — segment kits carry editorial wrap footage, not the launch video, so
// "launch video" would misdescribe the content.
export function buildWrapAlt(brief, brand) {
  const headline = brief?.hook || brand.tagline;
  return `${brand.name} video: ${headline}.`;
}

// Manifest entry for one platform folder. Paths are relative to the postkit
// root; null means that artifact was not assembled (partial kits are normal).
export function manifestEntry(platformKey, cfg, {hasVideo, thumbFile, srtCopied, vttCopied}) {
  return {
    video: hasVideo ? `${platformKey}/${cfg.videoSource}.mp4` : null,
    caption: `${platformKey}/caption.txt`,
    alt: `${platformKey}/alt.txt`,
    thumb: thumbFile ? `${platformKey}/${thumbFile}` : null,
    srt: srtCopied ? `${platformKey}/launch.srt` : null,
    vtt: vttCopied ? `${platformKey}/launch.vtt` : null,
    note: cfg.note,
  };
}

// The machine-readable interface consumed by launch-engine (PostKitManifestSchema).
// `segments` (WrapClip segment kits, keyed by segmentId) is only present when at
// least one segment kit was assembled — brands without wrap matrix dirs produce a
// manifest identical in shape to before segments existed.
export function buildManifest(brand, generatedAt, platforms, segments = null) {
  const manifest = {version: 1, brand, generatedAt, platforms};
  if (segments && Object.keys(segments).length > 0) manifest.segments = segments;
  return manifest;
}

// WrapClip segment discovery: render-matrix.mjs --props nests each segment's
// exports under out/<brand>/matrix/wrap-<segmentId>/. Given the matrix dir's
// directory names and a lister for each dir's file names, return {ids, skipped}:
// only dirs containing at least one wrap-*.mp4 count as segments; stray wrap-
// prefixed dirs (empty, or holding only stills/frames) land in `skipped` so the
// caller can log them instead of assembling an all-missing kit. Both lists are
// empty for brands with no wrap dirs.
export function wrapSegmentIds(dirNames, filesIn) {
  const ids = [];
  const skipped = [];
  for (const name of dirNames) {
    if (!name.startsWith('wrap-')) continue;
    const id = name.slice('wrap-'.length);
    const hasVideo = filesIn(name).some((f) => f.startsWith('wrap-') && f.endsWith('.mp4'));
    (hasVideo ? ids : skipped).push(id);
  }
  return {ids, skipped};
}

// Manifest entry for one platform folder inside a wrap segment kit. Same field set
// as manifestEntry so launch-engine consumes both shapes uniformly; thumb/srt/vtt
// are always null — those artifacts trace to the brand's launch video
// (extract-thumbs.mjs / build-captions.mjs), not to the wrap segment, so segment
// kits deliberately omit them rather than ship mislabeled launch assets.
export function wrapKitEntry(segmentId, platformKey, cfg, hasVideo) {
  const kitPath = `wrap-${segmentId}/${platformKey}`;
  return {
    video: hasVideo ? `${kitPath}/wrap-${cfg.aspect}.mp4` : null,
    caption: `${kitPath}/caption.txt`,
    alt: `${kitPath}/alt.txt`,
    thumb: null,
    srt: null,
    vtt: null,
    note: cfg.note,
  };
}

function postMd(brandLabel, platformKey, cfg, videoStatus, thumbStatus, captionFilesLine) {
  const label = PLATFORM_LABELS[platformKey];
  return `# ${brandLabel} — ${label} post kit

## Files
- Video: ${videoStatus}
- Thumbnail: ${thumbStatus}
- Caption: caption.txt (paste as the post copy)
- Alt text: alt.txt (one-sentence video description)
${captionFilesLine}

## Notes
${cfg.note}
`;
}

// --- main pipeline (I/O) -----------------------------------------------------

function main() {
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
    process.exit(1);
  });

  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const brand = process.argv[2];
  if (!brand) {
    console.error('usage: node scripts/build-postkit.mjs <brand>');
    process.exit(1);
  }

  const brandPath = join(root, 'brands', `${brand}.json`);
  if (!existsSync(brandPath)) {
    console.error(`build-postkit: brands/${brand}.json not found — required for the tagline fallback and brand name.`);
    process.exit(1);
  }
  const brandData = JSON.parse(readFileSync(brandPath, 'utf8'));

  const briefPath = join(root, 'out', brand, 'marketing', 'brief.json');
  let brief = null;
  if (existsSync(briefPath)) {
    try {
      const raw = JSON.parse(readFileSync(briefPath, 'utf8'));
      const platformEntry = (p) => (p && typeof p.hook === 'string' && typeof p.headline === 'string' ? {hook: p.hook, headline: p.headline} : null);
      brief = {
        hook: typeof raw.hook?.headline === 'string' ? raw.hook.headline : null,
        social: {
          x: platformEntry(raw.social?.x),
          linkedin: platformEntry(raw.social?.linkedin),
          vertical: platformEntry(raw.social?.vertical),
        },
      };
    } catch (err) {
      console.warn(`build-postkit: out/${brand}/marketing/brief.json is not valid JSON, using tagline fallback: ${err.message}`);
    }
  } else {
    console.log(`build-postkit: no out/${brand}/marketing/brief.json — all captions use the brand tagline fallback`);
  }

  const matrixDir = join(root, 'out', brand, 'matrix');
  const thumbsDir = join(root, 'out', brand, 'thumbs');
  const captionsDir = join(root, 'out', brand, 'captions');
  const postkitDir = join(root, 'out', brand, 'postkit');

  let assembledCount = 0;
  const manifestPlatforms = {};

  // Caption, gated by lint-copy before it is trusted (shared by the brand kit and
  // the wrap segment kits below — identical gate, different label/target dir).
  const writeGatedCaption = (dir, platformKey, label) => {
    const captionText = buildCaption(platformKey, brief, brandData);
    const violations = lintJson({caption: captionText});
    const errorCount = violations.filter((v) => v.level === 'ERROR').length;
    if (errorCount > 0) {
      console.error(formatReport(`${label}/caption.txt`, violations));
      console.error(`build-postkit: FAILED — lint-copy found ${errorCount} violation(s) in ${label}'s caption`);
      process.exit(1);
    }
    writeFileSync(join(dir, 'caption.txt'), captionText + '\n');
  };

  for (const [platformKey, cfg] of Object.entries(PLATFORM_MAP)) {
    const dir = join(postkitDir, platformKey);
    mkdirSync(dir, {recursive: true});

    // Video.
    const videoSrc = join(matrixDir, `${cfg.videoSource}.mp4`);
    let videoStatus;
    if (existsSync(videoSrc)) {
      copyFileSync(videoSrc, join(dir, `${cfg.videoSource}.mp4`));
      videoStatus = `${cfg.videoSource}.mp4`;
      assembledCount += 1;
    } else {
      videoStatus = `NOT INCLUDED (missing out/${brand}/matrix/${cfg.videoSource}.mp4 — run render-matrix.mjs)`;
      console.log(`postkit: ${platformKey}: skipped video, ${cfg.videoSource}.mp4 not found in out/${brand}/matrix/`);
    }

    // Thumbnail (jpg preferred, png fallback per extract-thumbs.mjs).
    const thumbJpg = join(thumbsDir, `thumb-${cfg.aspect}.jpg`);
    const thumbPng = join(thumbsDir, `thumb-${cfg.aspect}.png`);
    let thumbStatus;
    if (existsSync(thumbJpg)) {
      copyFileSync(thumbJpg, join(dir, 'thumb.jpg'));
      thumbStatus = 'thumb.jpg';
      assembledCount += 1;
    } else if (existsSync(thumbPng)) {
      copyFileSync(thumbPng, join(dir, 'thumb.png'));
      thumbStatus = 'thumb.png';
      assembledCount += 1;
    } else {
      thumbStatus = `NOT INCLUDED (missing out/${brand}/thumbs/thumb-${cfg.aspect}.jpg — run extract-thumbs.mjs)`;
      console.log(`postkit: ${platformKey}: skipped thumbnail, thumb-${cfg.aspect}.(jpg|png) not found in out/${brand}/thumbs/`);
    }
    const thumbFile = thumbStatus.startsWith('NOT') ? null : thumbStatus;

    writeGatedCaption(dir, platformKey, platformKey);
    assembledCount += 1;

    // Alt text.
    writeFileSync(join(dir, 'alt.txt'), buildAlt(brief, brandData) + '\n');
    assembledCount += 1;

    // Caption sidecars (youtube + linkedin only).
    let captionFilesLine = '';
    let srtCopied = false;
    let vttCopied = false;
    if (cfg.captionFile) {
      const srtSrc = join(captionsDir, 'launch.srt');
      const vttSrc = join(captionsDir, 'launch.vtt');
      const copied = [];
      if (existsSync(srtSrc)) {
        copyFileSync(srtSrc, join(dir, 'launch.srt'));
        copied.push('launch.srt');
        srtCopied = true;
      }
      if (existsSync(vttSrc)) {
        copyFileSync(vttSrc, join(dir, 'launch.vtt'));
        copied.push('launch.vtt');
        vttCopied = true;
      }
      if (copied.length) {
        captionFilesLine = `- Captions: ${copied.join(', ')} (upload alongside the video)`;
        assembledCount += 1;
      } else {
        captionFilesLine = `- Captions: NOT INCLUDED (missing out/${brand}/captions/launch.srt — run build-captions.mjs)`;
        console.log(`postkit: ${platformKey}: skipped caption sidecars, out/${brand}/captions/launch.srt not found`);
      }
    }

    writeFileSync(join(dir, 'POST.md'), postMd(brandData.name ?? brand, platformKey, cfg, videoStatus, thumbStatus, captionFilesLine));
    assembledCount += 1;

    manifestPlatforms[platformKey] = manifestEntry(platformKey, cfg, {
      hasVideo: existsSync(videoSrc),
      thumbFile,
      srtCopied,
      vttCopied,
    });

    console.log(`postkit: wrote out/${brand}/postkit/${platformKey}/ (video: ${existsSync(videoSrc) ? 'yes' : 'skipped'}, thumb: ${thumbStatus.startsWith('NOT') ? 'skipped' : 'yes'})`);
  }

  // WrapClip segment kits: one kit per out/<brand>/matrix/wrap-<segmentId>/ dir
  // (render-matrix.mjs --comp WrapClip --props). Reuses the platform table and the
  // same lint-gated, brief-sourced caption path as the brand kit; thumbs and
  // srt/vtt sidecars are omitted — launch-video artifacts, not segment artifacts
  // (see wrapKitEntry). Brands with no wrap dirs skip this loop entirely.
  const manifestSegments = {};
  const matrixDirNames = existsSync(matrixDir)
    ? readdirSync(matrixDir, {withFileTypes: true}).filter((e) => e.isDirectory()).map((e) => e.name)
    : [];
  const {ids: segmentIds, skipped: strayWrapDirs} = wrapSegmentIds(
    matrixDirNames,
    (name) => readdirSync(join(matrixDir, name)),
  );
  for (const strayId of strayWrapDirs) {
    console.log(`postkit: skipped matrix/wrap-${strayId}/ (no wrap-*.mp4 inside — not a segment export dir)`);
  }
  for (const segmentId of segmentIds) {
    const segMatrixDir = join(matrixDir, `wrap-${segmentId}`);
    const segEntries = {};
    for (const [platformKey, cfg] of Object.entries(PLATFORM_MAP)) {
      const kitLabel = `wrap-${segmentId}/${platformKey}`;
      const dir = join(postkitDir, `wrap-${segmentId}`, platformKey);
      mkdirSync(dir, {recursive: true});

      // Video: the segment's own aspect-matched export.
      const videoName = `wrap-${cfg.aspect}.mp4`;
      const videoSrc = join(segMatrixDir, videoName);
      const hasVideo = existsSync(videoSrc);
      let videoStatus;
      if (hasVideo) {
        copyFileSync(videoSrc, join(dir, videoName));
        videoStatus = videoName;
        assembledCount += 1;
      } else {
        videoStatus = `NOT INCLUDED (missing out/${brand}/matrix/wrap-${segmentId}/${videoName} — run render-matrix.mjs --comp WrapClip --props props/${brand}-wrap-${segmentId}.json)`;
        console.log(`postkit: ${kitLabel}: skipped video, ${videoName} not found in out/${brand}/matrix/wrap-${segmentId}/`);
      }

      writeGatedCaption(dir, platformKey, kitLabel);
      assembledCount += 1;

      writeFileSync(join(dir, 'alt.txt'), buildWrapAlt(brief, brandData) + '\n');
      assembledCount += 1;

      writeFileSync(
        join(dir, 'POST.md'),
        postMd(brandData.name ?? brand, platformKey, cfg, videoStatus, 'NOT INCLUDED (segment kits omit the brand launch thumbnail)', ''),
      );
      assembledCount += 1;

      segEntries[platformKey] = wrapKitEntry(segmentId, platformKey, cfg, hasVideo);
    }
    manifestSegments[segmentId] = segEntries;
    console.log(`postkit: wrote out/${brand}/postkit/wrap-${segmentId}/ (${Object.keys(PLATFORM_MAP).length} platform folders)`);
  }

  if (assembledCount === 0) {
    console.error(`build-postkit: FAILED — nothing could be assembled for ${brand}`);
    process.exit(1);
  }

  writeFileSync(
    join(postkitDir, 'manifest.json'),
    JSON.stringify(buildManifest(brand, new Date().toISOString(), manifestPlatforms, manifestSegments), null, 2) + '\n',
  );
  console.log(`postkit: wrote out/${brand}/postkit/manifest.json`);

  console.log(`postkit OK: ${Object.keys(PLATFORM_MAP).length} platform folders in out/${brand}/postkit/`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main();
}
