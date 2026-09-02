# Facebook Page setup

**Cost:** free.
**Time:** ~30 min (plus App Review wait if you need Live mode approval for some permissions).

1. Create an app at https://developers.facebook.com (type: Business).
2. Grant the app `pages_manage_posts` (+ `pages_read_engagement`) for your Page via Graph API Explorer or the app's use-case setup.
3. Get a **PAGE access token** (not a user token): User token → `GET /me/accounts` → copy the page's `access_token`. Long-lived page tokens don't expire.
4. Fill `.env`: `FB_APP_ID`, `FB_APP_SECRET`, `FB_PAGE_ID` (numeric), `FB_PAGE_ACCESS_TOKEN`.
5. **Put the app in LIVE mode** — Dev-mode posts publish "successfully" but are invisible to the public. This is the #1 silent failure.
6. Verify: `launch doctor` — it checks the token resolves to your page id (catches user-token mistakes) and reminds about Live mode.
