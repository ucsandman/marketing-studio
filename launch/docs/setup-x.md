# X (Twitter) setup

**Cost:** pay-per-use since Feb 2026 — $0.015 per text post, $0.20 per post containing a URL. A typical launch (3-post thread + 1 link reply) ≈ $0.25; budget ~$30 worst case if you iterate and reply actively all day. No free tier for new developers; billing must be enabled before the API accepts posts.
**Time:** ~30–45 min (app creation + billing setup).

1. Create a developer account + app at https://developer.x.com (Basic pay-per-use plan).
2. Enable billing on the developer account — posts fail without it.
3. In the app's **Keys & Tokens**: generate the API Key/Secret and an Access Token/Secret for the posting account (user context, read+write).
4. Fill `.env`: `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET`.
5. Verify: `launch doctor` should show `x | api | authenticated as @you`.

Engine behavior: threads post sequentially with reply chaining; the product link goes in a **reply** (the validator warns if a URL lands in the first post — 13x cost + ranking penalty).
