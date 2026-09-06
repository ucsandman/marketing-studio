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
// consumed by launch-engine (plus a `segments` key when segment kits exist) — and
// three more root-level files: LICENCES.md and DISCLOSURE.md (both below) and,
// per copied video, a silent -an cut for muted-autoplay embeds.
//
// DISCLOSURE.md: the synthetic-media sibling of LICENCES.md, at the kit root, for
// the same reason — an obligation that attaches at DISTRIBUTION time belongs next
// to the files being distributed. It lists what this pipeline actually
// synthesised for THIS brand (never a blanket "AI-generated" claim over
// programmatic motion graphics or over genuine screen capture), the per-platform
// self-disclosure control to set at upload, and the gaps it does not close —
// notably that no C2PA credential is embedded, which EU AI Act Article 50 has
// required for EU-facing synthetic content since 2026-08-02.
//
// Silent cuts: every copied video (`<name>.mp4`) gets a sibling `<name>-silent.mp4`
// via plain `ffmpeg -c copy -an` (stream-copy, no re-encode) — same ffmpeg-on-PATH
// convention as scripts/master-audio.mjs, since Remotion's bundled ffmpeg build
// lacks features this repo's post-render scripts depend on. A missing/failing
// ffmpeg is a logged skip for that one file, not a build failure (same partial-kit
// philosophy as a missing video/thumbnail source below).
//
// LICENCES.md: a stub record, at the kit root, of the music/SFX/font assets baked
// into this brand's renders (read from props/<brand>-audio.json and brands/<brand>.json)
// — one TODO line per asset actually present, so a human fills in the source/licence
// before external distribution instead of it being silently missing from the handoff.
//
// caption.txt is gated by scripts/lint-copy.mjs (imported directly, not spawned):
// any ERROR-level violation FAILS the whole build. Exits non-zero only if NOTHING
// could be assembled across every platform; partial kits are the expected outcome
// before render-matrix.mjs has produced full videos.
import {copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {evaluateProduction} from './judge-production.mjs';
import {sha256File} from './lib/production-quality.mjs';
import {lintJson, formatReport} from './lint-copy.mjs';
import {projectArg, resolveWorkspace, resolveWorkspacePath} from './lib/workspace.mjs';

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
    // A per-platform clip beats the generic matrix row: the matrix renders ONE
    // social props file (alphabetically first, so postflop's X folder carried the
    // LinkedIn clip, 2026-09-01). score-social-clip.mjs writes social-x-final.mp4.
    directSources: ['social-x-final', 'social-x'],
    captionFile: false,
    charBudget: 280,
    sourceKey: 'x',
    note: 'Upload the video file directly to X. Do not link out to YouTube; X suppresses off-platform links in the feed.',
    aiDisclosure: null,
  },
  linkedin: {
    aspect: '16x9',
    videoSource: 'launch-16x9',
    captionFile: true,
    charBudget: 3000,
    sourceKey: 'linkedin',
    note: 'Upload the video natively to LinkedIn (native video outperforms a link post). Paste caption.txt as the post body.',
    aiDisclosure: null,
  },
  tiktok: {
    aspect: '9x16',
    videoSource: 'social-9x16-captioned',
    captionFile: false,
    charBudget: 2200,
    sourceKey: 'vertical',
    note: 'Upload as a TikTok video post. The video already has burned-in captions; paste caption.txt as the on-app caption/hashtag line.',
    aiDisclosure: 'the "AI-generated content" toggle',
  },
  shorts: {
    aspect: '9x16',
    videoSource: 'social-9x16-captioned',
    captionFile: false,
    charBudget: 5000,
    sourceKey: 'vertical',
    note: 'Upload via YouTube Studio > Create > Upload video. Keep it vertical and under 60s so YouTube routes it to the Shorts shelf; paste caption.txt as the description.',
    aiDisclosure: 'the "Altered or synthetic content" disclosure',
  },
  youtube: {
    aspect: '16x9',
    videoSource: 'launch-16x9',
    captionFile: true,
    charBudget: 5000,
    sourceKey: null,
    note: 'Upload as a standard YouTube video. Paste caption.txt as the description, then upload launch.srt or launch.vtt as captions in YouTube Studio.',
    aiDisclosure: 'the "Altered or synthetic content" disclosure',
  },
  instagram: {
    aspect: '1x1',
    videoSource: 'social-1x1-captioned',
    captionFile: false,
    charBudget: 2200,
    sourceKey: 'vertical',
    note: 'Upload as an Instagram feed post or Reel. Paste caption.txt as the caption and alt.txt into Advanced settings > Accessibility > Alt text.',
    aiDisclosure: 'the "AI info" labelling in the composer',
  },
  bluesky: {
    aspect: '16x9',
    videoSource: 'social-16x9',
    directSources: ['social-x-final', 'social-x'],
    captionFile: false,
    charBudget: 300,
    sourceKey: 'x',
    note: 'Publish with node scripts/publish-bluesky.mjs <brand> (or the Publish to Bluesky button in Mission Control); it uploads social-16x9.mp4, posts caption.txt with alt.txt, and records the URL in posts.json. Links in the caption become tappable.',
    aiDisclosure: null,
  },
};

const PLATFORM_LABELS = {
  x: 'X',
  linkedin: 'LinkedIn',
  tiktok: 'TikTok',
  shorts: 'YouTube Shorts',
  youtube: 'YouTube',
  instagram: 'Instagram',
  bluesky: 'Bluesky',
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

// Campaign-level destination link for the Before-you-publish block. brandUrl is
// the bare host (or, for magnetic, a github.com repo path) from brands/<id>.json;
// https:// is prepended here since the brand file stores it bare. A github.com
// repo link prints bare with no UTM tags — a repo isn't a marketing landing page,
// and tagging it would just pollute the URL any visitor copies out. Everything
// else gets campaign-level tags only (source/medium/campaign, no utm_content —
// this pipeline doesn't produce enough creative variants per platform to need it).
export function postMd(brandLabel, platformKey, cfg, videoStatus, thumbStatus, silentStatus, captionFilesLine, brandSlug, brandUrl) {
  const label = PLATFORM_LABELS[platformKey];
  const silentLine = silentStatus ? `\n- Silent cut: ${silentStatus} (muted-autoplay embeds)` : '';
  // Disclosure is a numbered upload step, not a footnote: declaring synthetic
  // audio yourself costs almost nothing in reach, while being caught undisclosed
  // applies a distribution hold during the window that decides how far the post
  // travels. Platforms with no mandatory control still get a line, so the
  // operator never has to remember which ones those are.
  const disclosureStep = cfg.aiDisclosure
    ? `Set ${cfg.aiDisclosure} before publishing if this cut has synthetic voiceover or music (see DISCLOSURE.md at the kit root).`
    : `No mandatory AI toggle on ${label} today — if the voiceover is synthetic, say so in the copy (see DISCLOSURE.md at the kit root).`;

  const dest = `https://${brandUrl}`;
  const link = /^https:\/\/github\.com\//.test(dest)
    ? dest
    : `${dest}?utm_source=${platformKey}&utm_medium=video&utm_campaign=${brandSlug}`;
  const linkStep = platformKey === 'x'
    ? `Paste ${link} in the first reply, not the post body — external links in the body cut reach (see skills/launch/SKILL.md).`
    : `Destination link: ${link}`;
  const postsStep = `After publishing, paste the live post URL into out/${brandSlug}/marketing/posts.json's \`url\` field for this platform (and set \`published\` to true).`;

  return `# ${brandLabel} — ${label} post kit

## Files
- Video: ${videoStatus}${silentLine}
- Thumbnail: ${thumbStatus}
- Caption: caption.txt (paste as the post copy)
- Alt text: alt.txt (one-sentence video description)
${captionFilesLine}

## Before you publish
1. ${disclosureStep}
2. ${linkStep}
3. ${postsStep}

## Notes
${cfg.note}
`;
}

// Seed rows for out/<brand>/marketing/posts.json — one per PLATFORM_MAP key, all
// unpublished. fetch-results.mjs treats a `published: false` or `url: null` row
// as a skip, not an error, so a freshly-built kit with nothing posted yet reports
// cleanly instead of looking like a failure.
export function seedPostsRows() {
  return Object.keys(PLATFORM_MAP).map((platform) => ({platform, url: null, variant: null, published: false}));
}

// LICENCES.md content for the postkit root (see the header comment). Assets not
// used by this brand (no music track, sfx not enabled) get a one-line "not used"
// note instead of an invented TODO — a stub records only what is actually present.
export function buildLicencesMd(brandLabel, brandData, audioManifest) {
  const musicSrc = audioManifest?.music?.src ?? null;
  const musicLines = musicSrc
    ? [`- \`${musicSrc}\`: TODO source, licence, and attribution requirement`]
    : audioManifest
      ? ['- No music track for this brand.']
      : ['- No audio manifest for this brand (`props/<brand>-audio.json` not found), so renders are silent.'];

  const sfxEnabled = audioManifest?.sfx?.enabled === true;
  const sfxLines = sfxEnabled
    ? ['whoosh', 'tick', 'riser'].map(
        (kind) => `- \`assets/sfx/${kind}.mp3\`: TODO source, licence, and commercial-use terms`,
      )
    : ['- SFX not enabled for this brand.'];

  const fonts = brandData?.fonts ?? {};
  const fontFamilies = [...new Set([fonts.display, fonts.body, fonts.mono].filter(Boolean))];
  const fontLines = fontFamilies.length
    ? fontFamilies.map((f) => `- ${f} (Google Fonts, studio/src/lib/fonts.ts): TODO confirm OFL licence and weights in use`)
    : ['- No fonts recorded for this brand.'];

  return `# ${brandLabel} postkit LICENCES

Source/licence record for the music, SFX, and font assets baked into this postkit's
video renders. Fill in every TODO before external distribution.

## Music
${musicLines.join('\n')}

## SFX
${sfxLines.join('\n')}

## Fonts
${fontLines.join('\n')}
`;
}

// DISCLOSURE.md content for the postkit root — the synthetic-media sibling of
// LICENCES.md, and for the same reason: an obligation that attaches at
// DISTRIBUTION time, recorded next to the files a human is about to distribute
// rather than left to memory.
//
// Two facts drive the shape:
//
//   1. EU AI Act Article 50 has required machine-readable disclosure of synthetic
//      content shown to EU users since 2026-08-02. This kit does NOT embed a C2PA
//      credential — doing so needs `c2patool` plus a signing certificate, which is
//      a new external dependency and a key-handling decision, not something a
//      build script should quietly acquire. So this file states the gap plainly
//      instead of implying coverage.
//   2. Platform disclosure is far cheaper PROACTIVELY than retroactively. A
//      self-declared label costs close to nothing in reach; an undisclosed asset
//      caught by platform detection gets a distribution hold applied during
//      exactly the early-engagement window that decides algorithmic push. The
//      toggle is therefore a numbered upload step, not a footnote.
//
// What is listed is what this pipeline actually synthesises, per brand — never a
// blanket "AI-generated" claim over hand-authored work.
export function buildDisclosureMd(brandLabel, audioManifest, hasCapture) {
  const synthetic = [];
  if (audioManifest?.lines?.length) {
    synthetic.push(
      `- **Voiceover** — synthetic speech (${audioManifest.lines.length} line(s), text-to-speech). This is a synthetic VOICE and is disclosable on every platform below.`,
    );
  }
  if (audioManifest?.music?.src) {
    synthetic.push('- **Music bed** — generated track. Disclosable as synthetic audio.');
  }
  if (audioManifest?.sfx?.enabled === true) {
    synthetic.push('- **Sound effects** — generated. Usually not separately disclosable, but it is synthetic audio.');
  }
  synthetic.push(
    '- **Motion graphics / titles / mark animation** — rendered programmatically from brand tokens (Remotion). Not "AI-generated imagery": no generative image model produced these frames, so a blanket AI label would be inaccurate.',
  );
  if (hasCapture) {
    synthetic.push(
      '- **Product footage** — a real screen recording of the real application. Genuine capture, not synthetic. Do not label it as generated.',
    );
  }
  const nothingSynthetic = !audioManifest?.lines?.length && !audioManifest?.music?.src;

  return `# ${brandLabel} postkit DISCLOSURE

What in this kit is synthetic, and what to declare when you upload it. Read this
before distribution, the same way you read LICENCES.md.

## What this pipeline actually synthesised

${synthetic.join('\n')}

## At upload: declare it yourself

Tick the platform's own AI-content toggle **before** publishing${nothingSynthetic ? ', if any synthetic audio is added later' : ''}.
Proactive disclosure costs close to nothing in reach. An undisclosed asset caught
by platform detection instead gets a distribution hold applied while the label is
applied retroactively, and that hold lands during the early-engagement window that
decides how far the post travels. The cost is in being caught, not in disclosing.

- TikTok — "AI-generated content" toggle at upload.
- YouTube — "Altered or synthetic content" disclosure in the upload flow.
- Instagram / Facebook — "AI info" labelling in the composer.
- LinkedIn / X — no mandatory toggle today; say so in the copy if the voice is synthetic.

## Known gaps in this kit

- **No C2PA credential is embedded.** EU AI Act Article 50 has required
  machine-readable synthetic-content disclosure for EU-facing content since
  2026-08-02, and the files in this kit carry no cryptographic provenance
  manifest. Platform self-declaration above is a human step, not a
  machine-readable one. Closing this needs \`c2patool\` and a signing certificate.
- **If you automate posting to TikTok**, note that its Content Posting API
  publishes every video as private-only until the app passes TikTok's audit. An
  unaudited integration succeeds at every API call and reaches nobody.
`;
}

// Silent cut: `-c copy -an` strips the audio stream without re-encoding. Returns
// true on success; a missing/failing ffmpeg logs a skip and returns false (never
// throws — see the header comment on why this is a soft skip, not a build failure).
function writeSilentCut(srcPath, destPath, label) {
  const res = spawnSync('ffmpeg', ['-y', '-i', srcPath, '-c', 'copy', '-an', destPath], {encoding: 'utf8'});
  if (res.error || res.status !== 0 || !existsSync(destPath)) {
    const reason = res.error ? res.error.message : `ffmpeg exited ${res.status}`;
    console.log(`postkit: ${label}: skipped silent cut, ${reason}`);
    return false;
  }
  return true;
}

// --- main pipeline (I/O) -----------------------------------------------------

function main() {
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
    process.exit(1);
  });

  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const brand = process.argv[2];
  const production = process.argv.includes('--production');
  const project = projectArg(process.argv.slice(2));
  if (!brand) {
    console.error('usage: node scripts/build-postkit.mjs <brand> --project <product-repo> [--production]');
    process.exit(1);
  }
  const workspace = resolveWorkspace(root, {brand, project});
  if (!existsSync(workspace.projectRoot)) {
    console.error(`build-postkit: --project must name an existing product repository: ${workspace.projectRoot}`);
    process.exit(1);
  }

  const brandPath = join(root, 'brands', `${brand}.json`);
  if (!existsSync(brandPath)) {
    console.error(`build-postkit: brands/${brand}.json not found — required for the tagline fallback and brand name.`);
    process.exit(1);
  }
  const brandData = JSON.parse(readFileSync(brandPath, 'utf8'));

  const briefPath = join(workspace.marketingDir, 'brief.json');
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

  // Audio manifest, for LICENCES.md's music/SFX lines only (build-captions.mjs and
  // render-matrix.mjs are the consumers that drive the actual render/caption path).
  const audioPropsPath = join(workspace.propsDir, `${brand}-audio.json`);
  const audioManifest = existsSync(audioPropsPath) ? JSON.parse(readFileSync(audioPropsPath, 'utf8')) : null;

  const matrixDir = workspace.matrixDir;
  const thumbsDir = workspace.thumbsDir;
  const captionsDir = workspace.captionsDir;
  const postkitDir = workspace.postkitDir;
  let productionEvidence = null;
  let productionPlanPath = null;
  if (production) {
    const evidencePath = join(workspace.marketingDir, 'delivery-evidence.json');
    if (!existsSync(evidencePath)) {
      console.error(`build-postkit: --production requires out/${brand}/marketing/delivery-evidence.json from render-matrix.mjs --production`);
      process.exit(1);
    }
    try {
      productionEvidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
    } catch (error) {
      console.error(`build-postkit: invalid delivery evidence: ${error.message}`);
      process.exit(1);
    }
    productionPlanPath = resolveWorkspacePath(workspace, productionEvidence?.plan ?? join(workspace.marketingDir, 'production-plan.json'));
    if (productionEvidence?.version !== 1 || !Array.isArray(productionEvidence.exports) || !existsSync(productionPlanPath) || productionEvidence.planSha256 !== sha256File(productionPlanPath)) {
      console.error('build-postkit: production evidence is incomplete or stale for the current production plan');
      process.exit(1);
    }
  }
  const verifyProductionVideo = (id, videoSrc) => {
    const evidence = productionEvidence.exports.find((entry) => entry.id === id);
    const expectedPath = `marketing/assets/${brand}/matrix/${id}.mp4`;
    if (!evidence || evidence.path !== expectedPath || evidence.sha256 !== sha256File(videoSrc)) {
      console.error(`build-postkit: production refuses ${id}; its matrix bytes have no matching current approval evidence`);
      process.exit(1);
    }
    if (!evidence.evidence || !evidence.review) {
      console.error(`build-postkit: row-specific production evidence or review is missing for ${id}`);
      process.exit(1);
    }
    const report = evaluateProduction({
      workspace,
      brand,
      productionPlanPath,
      renderPath: videoSrc,
      evidencePath: resolveWorkspacePath(workspace, evidence.evidence),
      reviewPath: resolveWorkspacePath(workspace, evidence.review),
    });
    if (report.verdict !== 'PASS' || report.input?.renderSha256 !== evidence.sha256 || report.input?.sourceBundleSha256 !== evidence.sourceBundleSha256) {
      console.error(`build-postkit: current production sources, evidence, or trusted review do not PASS for ${id}`);
      process.exit(1);
    }
  };

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

    // Video, plus a silent -an cut for muted-autoplay embeds (see header comment).
    let videoSrc = join(matrixDir, `${cfg.videoSource}.mp4`);
    for (const direct of production ? [] : cfg.directSources ?? []) {
      const candidate = join(workspace.brandRoot, `${direct}.mp4`);
      if (existsSync(candidate)) {
        videoSrc = candidate;
        console.log(`postkit: ${platformKey}: using per-platform clip ${direct}.mp4 over matrix/${cfg.videoSource}.mp4`);
        break;
      }
    }
    let videoStatus;
    let silentFile = null;
    if (existsSync(videoSrc)) {
      if (production) verifyProductionVideo(cfg.videoSource, videoSrc);
      const destVideo = join(dir, `${cfg.videoSource}.mp4`);
      copyFileSync(videoSrc, destVideo);
      videoStatus = `${cfg.videoSource}.mp4`;
      assembledCount += 1;

      const silentName = `${cfg.videoSource}-silent.mp4`;
      if (writeSilentCut(destVideo, join(dir, silentName), platformKey)) {
        silentFile = silentName;
        assembledCount += 1;
      }
    } else {
      if (production) {
        console.error(`build-postkit: production requires approved matrix/${cfg.videoSource}.mp4 for ${platformKey}`);
        process.exit(1);
      }
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

    const silentStatus = silentFile ?? (existsSync(videoSrc) ? 'NOT INCLUDED (ffmpeg unavailable — see console output above)' : null);
    writeFileSync(
      join(dir, 'POST.md'),
      postMd(brandData.name ?? brand, platformKey, cfg, videoStatus, thumbStatus, silentStatus, captionFilesLine, brand, brandData.url),
    );
    assembledCount += 1;

    manifestPlatforms[platformKey] = {
      ...manifestEntry(platformKey, cfg, {
        hasVideo: existsSync(videoSrc),
        thumbFile,
        srtCopied,
        vttCopied,
      }),
      silent: silentFile ? `${platformKey}/${silentFile}` : null,
    };

    console.log(`postkit: wrote out/${brand}/postkit/${platformKey}/ (video: ${existsSync(videoSrc) ? 'yes' : 'skipped'}, thumb: ${thumbStatus.startsWith('NOT') ? 'skipped' : 'yes'})`);
  }

  // Seed out/<brand>/marketing/posts.json, once — the operator (or launch-engine)
  // fills in url/published after actually posting, so a rebuild must never
  // clobber that. Only write it when it doesn't exist yet.
  const postsPath = join(workspace.marketingDir, 'posts.json');
  if (existsSync(postsPath)) {
    console.log(`postkit: out/${brand}/marketing/posts.json already exists, left unchanged`);
  } else {
    mkdirSync(dirname(postsPath), {recursive: true});
    writeFileSync(postsPath, JSON.stringify(seedPostsRows(), null, 2) + '\n');
    console.log(`postkit: wrote out/${brand}/marketing/posts.json (seed, ${Object.keys(PLATFORM_MAP).length} platform rows)`);
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

      // Video: the segment's own aspect-matched export, plus a silent -an cut.
      const videoName = `wrap-${cfg.aspect}.mp4`;
      const videoSrc = join(segMatrixDir, videoName);
      const hasVideo = existsSync(videoSrc);
      let videoStatus;
      let wrapSilentFile = null;
      if (hasVideo) {
        const destVideo = join(dir, videoName);
        copyFileSync(videoSrc, destVideo);
        videoStatus = videoName;
        assembledCount += 1;

        const silentName = `wrap-${cfg.aspect}-silent.mp4`;
        if (writeSilentCut(destVideo, join(dir, silentName), kitLabel)) {
          wrapSilentFile = silentName;
          assembledCount += 1;
        }
      } else {
        videoStatus = `NOT INCLUDED (missing out/${brand}/matrix/wrap-${segmentId}/${videoName} — run render-matrix.mjs --comp WrapClip --props props/${brand}-wrap-${segmentId}.json)`;
        console.log(`postkit: ${kitLabel}: skipped video, ${videoName} not found in out/${brand}/matrix/wrap-${segmentId}/`);
      }

      writeGatedCaption(dir, platformKey, kitLabel);
      assembledCount += 1;

      writeFileSync(join(dir, 'alt.txt'), buildWrapAlt(brief, brandData) + '\n');
      assembledCount += 1;

      const wrapSilentStatus = wrapSilentFile ?? (hasVideo ? 'NOT INCLUDED (ffmpeg unavailable — see console output above)' : null);
      writeFileSync(
        join(dir, 'POST.md'),
        postMd(
          brandData.name ?? brand,
          platformKey,
          cfg,
          videoStatus,
          'NOT INCLUDED (segment kits omit the brand launch thumbnail)',
          wrapSilentStatus,
          '',
          brand,
          brandData.url,
        ),
      );
      assembledCount += 1;

      segEntries[platformKey] = {
        ...wrapKitEntry(segmentId, platformKey, cfg, hasVideo),
        silent: wrapSilentFile ? `wrap-${segmentId}/${platformKey}/${wrapSilentFile}` : null,
      };
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

  writeFileSync(join(postkitDir, 'LICENCES.md'), buildLicencesMd(brandData.name ?? brand, brandData, audioManifest));
  console.log(`postkit: wrote out/${brand}/postkit/LICENCES.md`);

  // hasCapture drives one line in the disclosure: real screen footage must NOT be
  // labelled generated, and the kit should say so explicitly rather than let a
  // blanket "AI video" label get applied to a genuine recording.
  const hasCapture = existsSync(join(workspace.publicDir, brand, 'demo.webm'));
  writeFileSync(
    join(postkitDir, 'DISCLOSURE.md'),
    buildDisclosureMd(brandData.name ?? brand, audioManifest, hasCapture),
  );
  console.log(`postkit: wrote out/${brand}/postkit/DISCLOSURE.md`);

  console.log(`postkit OK: ${Object.keys(PLATFORM_MAP).length} platform folders in out/${brand}/postkit/`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main();
}
