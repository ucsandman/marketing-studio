# Google Search Console setup

**Cost:** free.
**Time:** ~20 min.

1. In Google Cloud Console: create (or reuse) a project → enable the **Search Console API**.
2. Create a **service account**; download its JSON key file. Keep the file outside the repo.
3. In Search Console (https://search.google.com/search-console): add your property (`sc-domain:yourdomain.com` via DNS verification — the launch flow's `set_dns_records` step can place the TXT record).
4. **Settings → Users and permissions → add the service-account email as a Full user.** Forgetting this is the #1 failure.
5. Fill `.env`: `GOOGLE_APPLICATION_CREDENTIALS` (absolute path to the JSON key), `GSC_SITE_URL` (e.g. `sc-domain:yourdomain.com`).
6. Verify: `launch doctor` → `google | api | service account authorized`.

Engine behavior: submits `<productUrl>/sitemap.xml` and runs a URL Inspection on the product URL. A new domain won't index instantly — the inspection verdict is informational. Google Business Profile is out of scope (60-day profile age gate makes it impossible for new products).
