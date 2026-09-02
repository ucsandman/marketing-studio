import type { LaunchConfig } from '../types.js';

/**
 * Announcement email layout (inline-styled for client compatibility).
 * `bodySlot` is HTML injected between header and CTA — scaffolds pass a
 * `{{placeholder}}` the skill fills; the footer carries the `{{unsubscribeUrl}}`
 * slot, which must also be filled before validation passes.
 */
export function emailHtmlTemplate(config: LaunchConfig, bodySlot: string): string {
  const { name, tagline, productUrl } = config;
  return [
    '<!DOCTYPE html>',
    '<html><body style="margin:0;padding:0;background:#f6f6f6;font-family:Arial,Helvetica,sans-serif">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">',
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden">',
    `<tr><td style="background:#111111;padding:24px 32px"><h1 style="margin:0;color:#ffffff;font-size:22px">${name}</h1>`,
    `<p style="margin:4px 0 0;color:#bbbbbb;font-size:14px">${tagline}</p></td></tr>`,
    `<tr><td style="padding:32px;color:#222222;font-size:15px;line-height:1.6">${bodySlot}</td></tr>`,
    `<tr><td align="center" style="padding:0 32px 32px"><a href="${productUrl}" style="display:inline-block;background:#111111;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-size:15px">Try ${name}</a></td></tr>`,
    `<tr><td style="padding:16px 32px;border-top:1px solid #eeeeee;color:#888888;font-size:12px">You're receiving this because you signed up for updates. <a href="{{unsubscribeUrl}}" style="color:#888888">Unsubscribe</a></td></tr>`,
    '</table></td></tr></table>',
    '</body></html>',
  ].join('\n');
}

/** Plaintext twin of the announcement email. */
export function emailTextTemplate(config: LaunchConfig, bodySlot: string): string {
  const { name, tagline, productUrl } = config;
  return [
    `${name} — ${tagline}`,
    '',
    bodySlot,
    '',
    `Try ${name}: ${productUrl}`,
    '',
    `You're receiving this because you signed up for updates. Unsubscribe: {{unsubscribeUrl}}`,
  ].join('\n');
}
