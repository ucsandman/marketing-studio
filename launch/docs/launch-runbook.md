# Launch-day runbook

The human checklist. The `/launch` skill drives the machinery; these are the parts where you decide, click, or wait. Run the **dry-run rehearsal** (README) at least one day before.

**The dashboard is the primary way to drive these steps by hand**: `launch ui` gives you the init form, draft editors, dry-run previews, gated live posting, and consent-checked notify — same engine, same gates ([guide](ui-dashboard.md)). CLI equivalents stay listed below for scripting and recovery.

## T-minus 1 week

- [ ] `launch doctor` (or the dashboard's **doctor** tab) — every provider you plan to use shows `api` (or `assist`); fix hints inline. LinkedIn token age < 55 days (re-auth if not — see docs/setup-linkedin.md).
- [ ] Contacts file in place: `<target>/.launch/contacts.json` with `consent: true` only for people who opted in.
- [ ] Pick the launch day: check https://hunted.space/stats for PH competition; Tue–Thu favored for HN.

## T-minus 1 day

- [ ] `launch research <dir>` (live) + session WebSearch synthesis — briefs fresh, `launch research <dir> --check` exits 0.
- [ ] Drafts filled and `launch copy <dir> --validate` exits 0 (dashboard: every **drafts** tab saves clean).
- [ ] Dry-run rehearsal green: dashboard **preview** tab shows every platform previewed/assist, or `launch post <dir> --all --dry-run` + `launch notify <dir> --channel email --dry-run` + `--channel sms --dry-run`.
- [ ] PH gallery assets ready per `.launch/out/producthunt-kit.md` checklist.

## Launch day

| Time (PT) | Step | How |
|---|---|---|
| 00:01 | Product Hunt submit | `launch post <dir> --platform producthunt --assist` → work through the kit; post the first comment immediately |
| morning | Infra live-check | product URL up, checkout works, `verify_launch` green |
| 06:00–09:00 | HN Show HN (9–12 ET) | `launch post <dir> --platform hackernews --assist` → click submit, paste maker comment |
| 08:00–10:00 | API platforms | `launch post <dir> --all` (X thread, FB page, LinkedIn + first-comment link, Reddit staggered, GSC sitemap); add `--kit <dir>` to attach a rendered post kit's video to X/LinkedIn (or wire `postkitDir` once via the dashboard's marketing tab) |
| 09:00 | Announce to your list | `launch notify <dir> --channel email` / `--channel sms` → skill passes payloads to `send_resend_email` / `send_twilio_sms` |
| all day | Engage | reply to every HN/PH/Reddit comment within minutes — first-hours engagement decides ranking everywhere |
| evening | Status check | `launch status <dir>`; `launch stats <dir> --platform producthunt` |

## Hard rules (the engine enforces, you don't override)

- Two SPEND gates (domain purchase, live Stripe) and one PUBLISH gate — nothing irreversible without your explicit approval.
- Consent: contacts without `consent: true` are never messaged.
- No automation on HN/PH beyond the prefilled one-click — automating those is a ban risk.
- The posted-ledger makes re-runs safe: completed platforms are skipped; `--force` overrides deliberately.
- A wired post kit that promises a video file missing on disk makes the post refuse (exit 1) before any network call; it never falls back to text-only silently. Re-render the kit or clear `postkitDir`.
- Same for a video that fails the platform's duration/size caps (X 140s/512 MB, LinkedIn 15min/5 GB) — the pre-flight media check runs automatically, in dry-run too, and the dashboard shows a red over-limit badge/note before you'd hit it live.

## If something breaks

- `launch doctor` for credential failures (each row has a fix hint).
- A failed platform doesn't block the others — `post --all` continues and reports.
- Degrade any blocked API platform to manual posting using the validated draft in `.launch/drafts/<platform>.json`.
