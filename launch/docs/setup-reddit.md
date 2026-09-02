# Reddit setup

**Cost:** free.
**Time:** ~15 min (assuming you already have an aged account).

1. On the posting account, create a **script** app at https://www.reddit.com/prefs/apps.
2. Fill `.env`: `REDDIT_CLIENT_ID` (under the app name), `REDDIT_CLIENT_SECRET`, `REDDIT_USERNAME`, `REDDIT_PASSWORD`, `REDDIT_USER_AGENT` (descriptive, e.g. `launch-engine/0.1 by u/yourname` — Reddit requires it).
3. Verify: `launch doctor` → `reddit | api | authenticated as u/you`.

**Account requirements (matter more than the API):** use an aged account with karma — new accounts get filtered. The engine fetches each subreddit's rules live before submitting, staggers multi-sub posts, and warns when bodies are identical across subs (cross-post spam = ban). Write a distinct angle per sub; the scaffold gives you three (r/SideProject, r/AlphaAndBetaUsers, r/IMadeThis).
