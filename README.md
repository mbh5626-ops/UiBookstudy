# Ui Books

A free fantasy-reading website on GitHub Pages with accounts, ratings, reviews, comments, followed authors, alerts, bookmarks and an author workflow (Supabase).

- Live site: https://mbh5626-ops.github.io/UiBookstudy/
- Stack: a static site. `index.html` is the main app (inline CSS and JavaScript). A build step (`build-pages.mjs`, run by `.github/workflows/deploy.yml`) generates the book, chapter, genre and author pages, the sitemap and the share images from the database.
- Routing: hash routes on the main page (`#home`, `#library`, `#book`, `#reader`, ...) and real pages for books and chapters (`books/<id>/chapter-<n>/`).
- Backend: Supabase (Postgres + Auth + Storage + row-level security). The pages contain only the project URL and the **publishable** key, which is public by design. Security comes from the database policies.
- Never commit a `service_role` / secret key, a Google client secret or a Facebook app secret. Those go only into the Supabase dashboard.

## Files

| File | Purpose |
|---|---|
| `index.html` | The main app: home, library, book, reader, study, saved, authors, profile |
| `ui-live.js` | Loads books, chapters, covers and settings from Supabase; contact form; feature switches |
| `ui-read.js` | Saved books and reading progress synced to the account, reading tools, share menu. Also loads `ui-social.js` |
| `ui-social.js` | Follow authors, alerts for new books and chapters, chapter bookmarks |
| `ui-music.js` | Ambient reading music and soft page navigation |
| `author.html` | Author dashboard: followers, reach and per-book numbers |
| `admin.html` | Staff and author tools: books, chapters, covers, moderation, settings |
| `apply.html` | Author applications |
| `build-pages.mjs`, `.github/workflows/deploy.yml` | Builds and deploys the generated pages every push and every 6 hours |
| `privacy.html`, `404.html`, `robots.txt`, `sitemap.xml` | Site basics |
| `supabase-schema.sql` | Original tables, policies, rate limits and functions |
| `supabase-social.sql` | Follows, alerts, bookmarks and the first author dashboard function |
| `supabase-traffic.sql` | Page-view counts and the upgraded author dashboard function (run after `supabase-social.sql`) |

## One-time setup

1. **Database.** Supabase → SQL Editor → New query → paste `supabase-schema.sql` → Run. Then do the same with `supabase-social.sql` and `supabase-traffic.sql`, in that order. All are safe to run again.
2. **Auth URLs.** Supabase → Authentication → URL Configuration:
   - Site URL: `https://mbh5626-ops.github.io/UiBookstudy/`
   - Redirect URLs: add `https://mbh5626-ops.github.io/UiBookstudy/**`
3. **Email sign-up.** Supabase → Authentication → Sign In / Providers → Email: keep "Confirm email" on.
4. **Google.** Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web application).
   Authorized JavaScript origin: `https://mbh5626-ops.github.io`
   Authorized redirect URI: `https://cqamtbmrlkkerwpnypdh.supabase.co/auth/v1/callback`
   Put the Client ID and secret into Supabase → Authentication → Sign In / Providers → Google. Publish the OAuth consent screen so everyone (not only test users) can sign in.
5. **Facebook.** developers.facebook.com → create an app → add Facebook Login.
   Valid OAuth redirect URI: `https://cqamtbmrlkkerwpnypdh.supabase.co/auth/v1/callback`
   Privacy policy URL and data deletion instructions URL: `https://mbh5626-ops.github.io/UiBookstudy/privacy.html`
   Put the App ID and secret into Supabase → Providers → Facebook, then switch the Facebook app to **Live** mode.
6. **First admin.** Sign up on the site first, then run in the SQL Editor (replace the email):
   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'YOUR_EMAIL_HERE' on conflict do nothing;
   ```
   Admin rights can only be granted this way.

## Following, alerts and bookmarks

- **Follow** buttons appear on author pages, book pages and in the main app. Readers are matched to authors by author name, ignoring upper and lower case.
- **Alerts** (the bell next to the account button) are created by database triggers: when a followed author's book is published, and when a chapter is added to a published book (to followers and to readers who saved the book). One chapter alert per reader per book per hour.
- **Bookmarks** save a paragraph. Tap the star at the end of a paragraph on a chapter page. They are listed under the bell and open at the saved paragraph.
- **Author dashboard** (`author.html`, linked as MY STATS in `admin.html` and from the bell) shows page views, followers, 30-day charts and per-book numbers. Authors see their own books; the site owner sees every book. It never shows who follows or who visited.
- **Traffic** is counted by `ui-social.js` on generated book and chapter pages: one count per visitor session per page, stored only as a number per book, chapter and day (`book_views`). Counts are approximate.
- If `supabase-social.sql` has not been run, these features hide themselves and the rest of the site works as before.
- New chapter pages exist after the next build (up to 6 hours, or run the workflow by hand). Until then, alert links open the book in the main app.

## Security model (summary)

- Row-level security is on for every table; anonymous visitors can only read public data.
- One rating per user per book (primary key). Ratings are written only through `rate_book()`; averages and distributions are computed from stored ratings by the `book_stats` view, so nobody can fake them.
- Users can only edit or delete their own reviews and comments (column-level grants + policies). They cannot change `user_id` or `status`.
- Follows, bookmarks and alerts are readable and removable only by their owner. Alerts are created only by database triggers, never by the browser.
- Admin actions (hide/delete content, close reports, stats) are functions that check the `admins` table on the server.
- Spam limits: 5 comments/minute, 3 reviews/10 minutes, 10 reports/10 minutes, 20 rating changes/minute, 20 follows/minute (300 total), 500 bookmarks per user.
- All user text is escaped before display and rendered as text, never as HTML.
- Deleting an account removes the user's ratings, library, follows, bookmarks and alerts; reviews and comments stay and show as "Deleted reader".

## Backups and recovery

Supabase free projects have no automatic downloadable backups that you control. Before big changes, export data from Supabase → Table Editor (CSV) or run `pg_dump` with your database connection string. Free projects pause after a week of inactivity; reading still works while the backend sleeps, and you can resume the project from the dashboard.

## Rollback

- Website: GitHub → open the file → History → pick the earlier version → Restore it. To undo the social features, restore `ui-read.js`, `privacy.html` and `README.md` and delete `ui-social.js` and `author.html`.
- Social database objects: the last lines of `supabase-social.sql` hold commented-out `drop` statements that remove only what that file created.

## Status

| Feature | Status |
|---|---|
| Reading, search, filters, study timer, light/dark | Implemented |
| Email, Google, Facebook login | Implemented; needs the provider setup in steps 4-5 |
| Profiles (name edit, avatar, sign out, delete account) | Implemented |
| Ratings, reviews, comments, replies, reports | Implemented |
| Synced saved books and reading progress | Implemented (`ui-read.js`) |
| Author applications, author tools, moderation, audit log | Implemented (`apply.html`, `admin.html`) |
| Generated book, chapter, genre and author pages | Implemented (`build-pages.mjs`) |
| Profile stats (books started, chapters read, streak, badges) count reading on the chapter pages too | Implemented (`ui-read.js` keeps a reading log, `ui-social.js` merges it) |
| Follow authors, alerts, bookmarks, author dashboard, page-view traffic | Implemented; needs `supabase-social.sql` and `supabase-traffic.sql` |
| Email or push alerts | Not implemented (alerts show in the site only) |
| Search by description | Partially implemented |
