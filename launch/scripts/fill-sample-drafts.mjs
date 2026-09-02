// Rehearsal helper: fill scaffolded drafts with valid sample content so the
// dry-run pipeline (validate → post --dry-run → notify --dry-run) can run end
// to end. Sample copy only — a real launch fills drafts from research briefs.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const target = process.argv[2];
if (!target) {
  console.error('usage: node scripts/fill-sample-drafts.mjs <target-dir>');
  process.exit(1);
}

const launchDir = join(target, '.launch');
const draftsDir = join(launchDir, 'drafts');
const config = JSON.parse(readFileSync(join(launchDir, 'launch.config.json'), 'utf8'));
const { name, tagline, productUrl, domain } = config;

const emailHtml = readFileSync(join(draftsDir, 'email.json'), 'utf8');
const scaffoldEmail = JSON.parse(emailHtml);

const drafts = {
  x: {
    platform: 'x', status: 'filled',
    thread: [
      `Your site went down at 3am. Your users noticed. You didn't. That's the problem ${name} kills.`,
      `${name} pings your endpoints every 30 seconds and alerts you on Slack, SMS, or email before anyone tweets about your outage.`,
    ],
    replyWithLink: `Set up your first monitor in under a minute → ${productUrl}`,
  },
  facebook: {
    platform: 'facebook', status: 'filled',
    message: `${name} is live: ${tagline}. Set up your first monitor in under a minute — no agent install required.`,
    link: productUrl,
  },
  linkedin: {
    platform: 'linkedin', status: 'filled',
    body: `My side project died overnight once and I slept through it. So I built ${name} — ${tagline}. Lesson: monitoring should take a minute to set up, not a weekend. Link in the first comment.`,
    firstComment: `Try ${name}: ${productUrl}`,
  },
  reddit: {
    platform: 'reddit', status: 'filled',
    posts: [
      { sub: 'SideProject', title: `I built ${name} — ${tagline}`, body: `Maker story: my own site died overnight, so I built a monitor that pings every 30s. Node + Postgres. Would love feedback on the alert routing.` },
      { sub: 'AlphaAndBetaUsers', title: `[Beta] ${name} — ${tagline}`, body: `Early users get the paid tier free for 3 months. Looking for feedback on onboarding friction and alert noise.` },
      { sub: 'IMadeThis', title: `${name}: ${tagline}`, body: `Built this in 6 weekends. The hard part was deduplicating flapping alerts. Screenshots in comments; roadmap is public.` },
    ],
  },
  hackernews: {
    platform: 'hackernews', status: 'filled',
    title: `Show HN: ${name} – uptime monitoring for solo devs`,
    url: productUrl,
    makerComment: `Maker here — built this after my own site died overnight and I slept through it. Node + Postgres, 30s checks. Would love feedback on the alert routing.`,
  },
  producthunt: {
    platform: 'producthunt', status: 'filled',
    tagline: tagline.length <= 60 ? tagline : tagline.slice(0, 60),
    description: `${name} watches your endpoints around the clock and pings you on Slack, SMS, or email before users notice. Setup takes under a minute.`,
    topics: ['Developer Tools', 'SaaS'],
    firstComment: 'Maker here — ask me anything about the alert pipeline.',
    galleryNotes: '- Hero 1270x760 done\n- Dashboard screenshot done\n- 60s demo video done',
  },
  email: {
    platform: 'email', status: 'filled',
    subject: scaffoldEmail.subject,
    html: scaffoldEmail.html
      .replace(/\{\{announcement body[^}]*\}\}/, `${name} is live today. Set up your first monitor in under a minute.`)
      .replace('{{unsubscribeUrl}}', `https://${domain}/unsubscribe`),
    text: scaffoldEmail.text
      .replace(/\{\{announcement body\}\}/, `${name} is live today. Set up your first monitor in under a minute.`)
      .replace('{{unsubscribeUrl}}', `https://${domain}/unsubscribe`),
  },
  sms: {
    platform: 'sms', status: 'filled',
    body: `${name} is live: uptime alerts for solo devs. ${productUrl}`,
  },
};

mkdirSync(draftsDir, { recursive: true });
for (const [platform, draft] of Object.entries(drafts)) {
  writeFileSync(join(draftsDir, `${platform}.json`), JSON.stringify(draft, null, 2) + '\n', 'utf8');
}
console.log(`Filled ${Object.keys(drafts).length} drafts with sample content.`);
