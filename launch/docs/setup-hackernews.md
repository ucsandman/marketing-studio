# Hacker News setup

**Cost:** free. **Time:** none.

There is nothing to configure — HN has no write API, and automating submission or voting is a ban risk. The engine's role is assisted-only:

- `launch post <dir> --platform hackernews --assist` validates the Show HN rules, opens a **prefilled** `submitlink` URL in your browser, and copies the maker comment to your clipboard. You review and click submit, then paste the maker comment as the first comment.

Show HN rules the validator enforces: title starts with `Show HN: `, ≤80 chars; URL-only submission; the product must be tryable right now; a maker comment ships with the submission. Best window: Tue–Thu, 9:00–12:00 ET.
