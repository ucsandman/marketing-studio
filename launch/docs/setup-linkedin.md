# LinkedIn (personal) setup

**Cost:** free.
**Time:** ~30 min initial; **recurring ~10 min every 60 days** (token re-auth — there is no programmatic refresh for self-serve apps).

1. Create an app at https://www.linkedin.com/developers/apps and request the **Share on LinkedIn** product (scope `w_member_social`).
2. Run the 3-legged OAuth flow (or the developer-portal token generator) to get a member access token.
3. Get your person URN: `GET https://api.linkedin.com/v2/userinfo` → `sub` → `urn:li:person:<sub>`.
4. Fill `.env`: `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_PERSON_URN`, `LINKEDIN_VERSION` (e.g. `202506`), and **`LINKEDIN_TOKEN_ISSUED_AT` (today's date)** — this powers the expiry warnings.
5. Verify: `launch doctor` — warns at 55 days, blocks at 60 with re-auth steps.

Engine behavior: the product link is posted as the **first comment**, not in the body (~18.8% reach penalty for body links — the validator warns). Company-page posting needs Community Management API approval (weeks) — out of scope; use an assisted manual post for the company page.
