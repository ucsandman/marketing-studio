# Product Hunt setup

**Cost:** free.
**Time:** ~5 min (token, optional) + launch-day prep from the kit.

Posting is **assisted by design** — Product Hunt has no create-post API. The engine produces `.launch/out/producthunt-kit.md` (tagline, description, topics, gallery checklist, first comment, schedule) and opens the submit page; you click through it.

Optional, for post-launch stats polling (`launch stats <dir> --platform producthunt`):

1. Create an API application at https://www.producthunt.com/v2/oauth/applications.
2. Copy the **Developer Token**.
3. Fill `.env`: `PRODUCTHUNT_DEV_TOKEN`.

Launch timing: 12:01 AM PT for the full 24h voting window; pick a low-competition day via https://hunted.space/stats (often Thursday). Never solicit votes directly — vote manipulation gets products delisted.
