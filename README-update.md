# Ui Books

A free fantasy-reading website hosted on GitHub Pages.

## Files
- `index.html` — the existing website. Apply `apply_update.py` to add technical improvements without changing the visual design.
- `privacy.html` — privacy policy for visitors and OAuth provider configuration.
- `robots.txt` and `sitemap.xml` — crawler guidance and public page discovery.
- `manifest.webmanifest` and `icons/` — installable PWA metadata and icons.
- `sw.js` — scoped service worker for network-first loading with cached offline fallback.
- `supabase-schema.sql` — existing database schema.

## Apply the update
1. Download and extract this package.
2. Copy `apply_update.py` into the repository root and run `python apply_update.py`. It checks every expected source fragment and stops without writing if anything differs. It also creates `index.html.backup` before changing the file.
3. Upload all other files and the `icons/` folder to the repository root, preserving paths.
4. Commit to `main` and wait for GitHub Pages to deploy.

## Supabase notes
The website contains a public Supabase publishable key. This is expected for browser clients; never put a service-role key or OAuth client secret in `index.html`.
The cloud library enhancement uses the existing `public.library` table and its existing RLS policy. It syncs favorite state and the last reading chapter after sign-in. It does not migrate existing anonymous local reading history to an account automatically.
Run `supabase-schema.sql` in Supabase SQL Editor if it has not already been applied. Do not rerun destructive rollback SQL.

## OAuth setup
In Supabase Authentication URL Configuration, use:
- Site URL: `https://mbh5626-ops.github.io/UiBookstudy/`
- Redirect URL: `https://mbh5626-ops.github.io/UiBookstudy/**`

Google and Facebook credentials must be configured in their provider dashboards and Supabase. The privacy policy URL is:
`https://mbh5626-ops.github.io/UiBookstudy/privacy.html`

## Contact form
The existing placeholder email was not a real address. The patch changes the form to open a prefilled **public GitHub issue** after a warning. Do not use this for private or sensitive messages. Replace it with a real private support channel when one is available.

## PWA
The service worker is scoped to `/UiBookstudy/` and uses network-first caching. After deploying a new version, the service worker updates its cache on subsequent page loads.
