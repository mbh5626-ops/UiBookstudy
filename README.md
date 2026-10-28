# Ui Books

A free fantasy-reading website on GitHub Pages with accounts, ratings, reviews and comments (Supabase).

- Live site: https://mbh5626-ops.github.io/UiBookstudy/
- Stack: one static `index.html` (inline CSS and JavaScript, no build step) + `privacy.html` + `404.html`.
- Routing: hash routes (`#home`, `#library`, `#book`, `#reader`, ...), so deep links survive a refresh on GitHub Pages.
- Backend: Supabase (Postgres + Auth + row-level security). The page contains only the project URL and the **publishable** key, which is public by design. Security comes from the database policies in `supabase-schema.sql`.
- Never commit a `service_role` / secret key, a Google client secret or a Facebook app secret. Those go only into the Supabase dashboard.

## Files

| File | Purpose |
|---|---|
| `index.html` | The whole site |
| `privacy.html` | Privacy policy (also used for Facebook login) |
| `404.html`, `robots.txt`, `sitemap.xml` | GitHub Pages basics |
| `supabase-schema.sql` | Tables, security policies, rate limits, functions, book catalog |

## One-time setup

1. **Database.** Supabase → SQL Editor → New query → paste `supabase-schema.sql` → Run. If it shows an error, fix that before continuing.
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

## Security model (summary)

- Row-level security is on for every table; anonymous visitors can only read public data.
- One rating per user per book (primary key). Ratings are written only through `rate_book()`; averages and distributions are computed from stored ratings by the `book_stats` view, so nobody can fake them.
- Users can only edit or delete their own reviews and comments (column-level grants + policies). They cannot change `user_id` or `status`.
- Admin actions (hide/delete content, close reports, stats) are functions that check the `admins` table on the server.
- Spam limits: 5 comments/minute, 3 reviews/10 minutes, 10 reports/10 minutes, 20 rating changes/minute per user.
- All user text is escaped before display and rendered as text, never as HTML.
- Deleting an account removes the user's ratings and library; reviews and comments stay and show as "Deleted reader".

## Backups and recovery

Supabase free projects have no automatic downloadable backups that you control. Before big changes, export data from Supabase → Table Editor (CSV) or run `pg_dump` with your database connection string. Free projects pause after a week of inactivity; reading still works while the backend sleeps, and you can resume the project from the dashboard.

## Rollback

- Website: GitHub → open `index.html` → History → pick the earlier version → Restore it.
- Database (removes everything created by the schema; this deletes all user content):
  ```sql
  drop view if exists public.book_stats, public.review_feed;
  drop table if exists public.reports, public.library, public.comments, public.reviews,
                       public.ratings, public.books, public.admins, public.profiles cascade;
  drop trigger if exists on_auth_user_created on auth.users;
  ```

## Status

| Feature | Status |
|---|---|
| Reading, search, filters, study timer, local saves | Implemented and verified |
| Email, Google, Facebook login UI | Implemented, awaiting external configuration (steps 1-5) |
| Profiles (name edit, sign out, delete account) | Implemented, awaiting database setup |
| Ratings, reviews, comments, replies, reports | Implemented, awaiting database setup |
| Synced favorites, reading list and progress | Not implemented (tables exist) |
| Admin moderation screen | Not implemented (server functions exist) |
| Search by description, sorting by rating/reviews | Partially implemented |
