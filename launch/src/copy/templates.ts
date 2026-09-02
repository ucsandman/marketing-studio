import { emailHtmlTemplate, emailTextTemplate } from '../comms/templates.js';
import type { Draft, LaunchConfig } from '../types.js';

/**
 * One scaffold per draft platform, pre-seeded with config facts.
 * Slots are `{{placeholder}}`s the /launch skill fills from research briefs —
 * never lorem ipsum. Structure encodes the platform hard rules (X first post
 * has no URL slot; LinkedIn link lives in firstComment; HN title prefixed).
 */
export function scaffoldDrafts(config: LaunchConfig): Draft[] {
  const { name, tagline, productUrl } = config;

  return [
    {
      platform: 'x',
      status: 'draft',
      thread: [
        `{{hook: the problem ${name} kills, one punchy line — NO link in this post}}`,
        `{{what ${name} does differently — concrete, not adjectives}}`,
        `{{proof moment: demo, number, or screenshot caption}}`,
      ],
      replyWithLink: `Try it here → ${productUrl}`,
    },
    {
      platform: 'facebook',
      status: 'draft',
      message: `${name} is live: ${tagline}\n\n{{2-3 plain-language sentences on what it does and who it helps}}`,
      link: productUrl,
    },
    {
      platform: 'linkedin',
      status: 'draft',
      body: `{{personal story: why I built ${name}}}\n\n{{one lesson or insight from building it}}\n\n{{call to action}} — link in the first comment.`,
      firstComment: `Try ${name}: ${productUrl}`,
    },
    {
      platform: 'reddit',
      status: 'draft',
      posts: [
        {
          sub: 'SideProject',
          title: `I built ${name} — ${tagline}`,
          body: `{{honest maker story for r/SideProject: what, why, stack, ask for feedback}}`,
        },
        {
          sub: 'AlphaAndBetaUsers',
          title: `[Beta] ${name} — ${tagline}`,
          body: `{{r/AlphaAndBetaUsers angle: what you get as an early user, what feedback you want}}`,
        },
        {
          sub: 'IMadeThis',
          title: `${name}: ${tagline}`,
          body: `{{r/IMadeThis angle: the build journey, screenshots described, what's next}}`,
        },
      ],
    },
    {
      platform: 'hackernews',
      status: 'draft',
      title: `Show HN: ${name} – ${tagline}`,
      url: productUrl,
      makerComment: `{{maker context: what it does, the stack, what feedback you want from HN}}`,
    },
    {
      platform: 'producthunt',
      status: 'draft',
      tagline: tagline.length <= 60 ? tagline : `{{tagline ≤60 chars}}`,
      description: `{{2-3 short paragraphs: problem, how ${name} solves it, who it's for}}`,
      topics: [`{{topic 1, e.g. "Developer Tools"}}`],
      firstComment: `{{maker first comment: story + ask, ready the moment the launch goes live}}`,
      galleryNotes: `{{gallery checklist: hero image 1270x760, 2-4 product shots, optional demo video}}`,
    },
    {
      platform: 'email',
      status: 'draft',
      subject: `${name} is live — ${tagline}`.slice(0, 78),
      html: emailHtmlTemplate(config, `<p>{{announcement body: what it is, why it matters to this list}}</p>`),
      text: emailTextTemplate(config, `{{announcement body}}`),
    },
    {
      platform: 'sms',
      status: 'draft',
      body: `${name} is live: {{short hook}} ${productUrl}`,
    },
  ];
}
