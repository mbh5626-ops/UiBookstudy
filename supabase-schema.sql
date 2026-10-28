-- =====================================================================
-- Ui Books · Supabase schema, security policies and seed data
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run.
-- Status: written carefully but NOT yet executed against your project.
-- If Supabase shows an error, copy the message and send it to me.
-- =====================================================================

-- ---------- 1. TABLES -------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 40),
  avatar_url text check (avatar_url is null or avatar_url ~ '^https://'),
  created_at timestamptz not null default now()
);

-- Admins live in their own table. Clients get NO access to it.
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.books (
  id text primary key check (id ~ '^[a-z0-9-]{3,60}$'),
  title text not null,
  author text not null,
  genre text not null,
  created_at timestamptz not null default now()
);

-- One rating per user per book (primary key). Writes go through rate_book().
create table if not exists public.ratings (
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  book_id text not null references public.books(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

-- Written reviews (separate from star ratings and from comments).
-- user_id becomes NULL if the author deletes their account (anonymized).
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  book_id text not null references public.books(id) on delete cascade,
  user_id uuid default auth.uid() references public.profiles(id) on delete set null,
  body text not null check (char_length(btrim(body)) between 10 and 5000),
  status text not null default 'visible' check (status in ('visible','hidden')),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create unique index if not exists reviews_one_per_user on public.reviews (book_id, user_id);
create index if not exists reviews_book_idx on public.reviews (book_id, created_at desc);

-- Discussion comments with one level of replies.
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  book_id text not null references public.books(id) on delete cascade,
  parent_id uuid references public.comments(id) on delete cascade,
  user_id uuid default auth.uid() references public.profiles(id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  status text not null default 'visible' check (status in ('visible','hidden')),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index if not exists comments_book_idx on public.comments (book_id, created_at desc);
create index if not exists comments_parent_idx on public.comments (parent_id);

-- Favorites, reading list status and reading progress. Private to each user.
create table if not exists public.library (
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  book_id text not null references public.books(id) on delete cascade,
  favorite boolean not null default false,
  status text check (status in ('planned','reading','completed')),
  chapter smallint not null default 0 check (chapter between 0 and 500),
  progress real not null default 0 check (progress between 0 and 1),
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

-- Abuse reports.
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid default auth.uid() references public.profiles(id) on delete set null,
  target_type text not null check (target_type in ('comment','review')),
  target_id uuid not null,
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  created_at timestamptz not null default now(),
  handled_by uuid references public.profiles(id) on delete set null
);
create unique index if not exists reports_once on public.reports (reporter_id, target_type, target_id);

-- ---------- 2. HELPER FUNCTIONS AND TRIGGERS --------------------------

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- Create a profile automatically when someone registers (email, Google or Facebook).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare nm text; av text;
begin
  nm := left(btrim(coalesce(new.raw_user_meta_data->>'full_name',
                            new.raw_user_meta_data->>'name',
                            split_part(coalesce(new.email, ''), '@', 1), '')), 40);
  if char_length(nm) < 2 then nm := 'Reader'; end if;
  av := coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture');
  if av is not null and av !~ '^https://' then av := null; end if;
  insert into public.profiles (id, display_name, avatar_url)
  values (new.id, nm, av)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Profiles for any accounts that already exist.
insert into public.profiles (id, display_name)
select id, 'Reader' from auth.users
on conflict (id) do nothing;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists ratings_touch on public.ratings;
create trigger ratings_touch before update on public.ratings
  for each row execute function public.touch_updated_at();
drop trigger if exists library_touch on public.library;
create trigger library_touch before update on public.library
  for each row execute function public.touch_updated_at();

create or replace function public.mark_edited() returns trigger
language plpgsql as $$
begin
  if new.body is distinct from old.body then new.edited_at := now(); end if;
  return new;
end $$;

drop trigger if exists comments_edited on public.comments;
create trigger comments_edited before update on public.comments
  for each row execute function public.mark_edited();
drop trigger if exists reviews_edited on public.reviews;
create trigger reviews_edited before update on public.reviews
  for each row execute function public.mark_edited();

-- Replies must point to a visible top-level comment on the same book.
create or replace function public.check_comment_parent() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.comments;
begin
  if new.parent_id is not null then
    select * into p from public.comments where id = new.parent_id;
    if not found or p.book_id <> new.book_id or p.parent_id is not null or p.status <> 'visible' then
      raise exception 'Invalid reply target.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists comments_parent_check on public.comments;
create trigger comments_parent_check before insert on public.comments
  for each row execute function public.check_comment_parent();

-- Simple spam protection (rate limits per user).
create or replace function public.limit_rate() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if tg_table_name = 'comments' then
    select count(*) into n from public.comments
      where user_id = new.user_id and created_at > now() - interval '1 minute';
    if n >= 5 then raise exception 'Too many comments. Please wait a minute.'; end if;
  elsif tg_table_name = 'reviews' then
    select count(*) into n from public.reviews
      where user_id = new.user_id and created_at > now() - interval '10 minutes';
    if n >= 3 then raise exception 'Too many reviews. Please wait a few minutes.'; end if;
  elsif tg_table_name = 'reports' then
    select count(*) into n from public.reports
      where reporter_id = new.reporter_id and created_at > now() - interval '10 minutes';
    if n >= 10 then raise exception 'Too many reports. Please wait a while.'; end if;
  end if;
  return new;
end $$;

drop trigger if exists comments_rate on public.comments;
create trigger comments_rate before insert on public.comments
  for each row execute function public.limit_rate();
drop trigger if exists reviews_rate on public.reviews;
create trigger reviews_rate before insert on public.reviews
  for each row execute function public.limit_rate();
drop trigger if exists reports_rate on public.reports;
create trigger reports_rate before insert on public.reports
  for each row execute function public.limit_rate();

-- ---------- 3. PUBLIC STATISTICS (always computed from real data) -----

create or replace view public.book_stats as
select
  b.id as book_id,
  count(r.rating)::int as ratings_count,
  coalesce(round(avg(r.rating)::numeric, 2), 0) as average,
  (count(*) filter (where r.rating = 1))::int as stars_1,
  (count(*) filter (where r.rating = 2))::int as stars_2,
  (count(*) filter (where r.rating = 3))::int as stars_3,
  (count(*) filter (where r.rating = 4))::int as stars_4,
  (count(*) filter (where r.rating = 5))::int as stars_5,
  (select count(*) from public.reviews v where v.book_id = b.id and v.status = 'visible')::int as reviews_count,
  (select count(*) from public.comments c where c.book_id = b.id and c.status = 'visible')::int as comments_count
from public.books b
left join public.ratings r on r.book_id = b.id
group by b.id;

-- Public review list with the author's name, picture and star rating.
-- (Ratings are otherwise private, so this view is the only place a rating
-- is shown next to the review its author chose to publish.)
create or replace view public.review_feed as
select rv.id, rv.book_id, rv.user_id, rv.body, rv.created_at, rv.edited_at,
       p.display_name, p.avatar_url, r.rating
from public.reviews rv
left join public.profiles p on p.id = rv.user_id
left join public.ratings r on r.book_id = rv.book_id and r.user_id = rv.user_id
where rv.status = 'visible';

-- ---------- 4. ACCESS CONTROL (RLS + column-level grants) -------------

alter table public.profiles enable row level security;
alter table public.admins   enable row level security;
alter table public.books    enable row level security;
alter table public.ratings  enable row level security;
alter table public.reviews  enable row level security;
alter table public.comments enable row level security;
alter table public.library  enable row level security;
alter table public.reports  enable row level security;

-- Start from zero access, then grant only what is needed.
revoke all on all tables in schema public from anon, authenticated;

grant select on public.books, public.profiles, public.book_stats, public.review_feed,
                public.reviews, public.comments to anon, authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;

grant select, delete on public.ratings to authenticated;          -- writes: rate_book()

grant insert (book_id, body), update (body) on public.reviews to authenticated;
grant delete on public.reviews to authenticated;
grant insert (book_id, parent_id, body), update (body) on public.comments to authenticated;
grant delete on public.comments to authenticated;

grant select, delete on public.library to authenticated;
grant insert (book_id, favorite, status, chapter, progress),
      update (book_id, favorite, status, chapter, progress) on public.library to authenticated;

grant select on public.reports to authenticated;
grant insert (target_type, target_id, reason) on public.reports to authenticated;
-- public.admins: no grants at all.

-- Policies
drop policy if exists books_read on public.books;
create policy books_read on public.books for select to anon, authenticated using (true);

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to anon, authenticated using (true);
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists ratings_select_own on public.ratings;
create policy ratings_select_own on public.ratings for select to authenticated using (user_id = auth.uid());
drop policy if exists ratings_delete_own on public.ratings;
create policy ratings_delete_own on public.ratings for delete to authenticated using (user_id = auth.uid());

drop policy if exists reviews_select on public.reviews;
create policy reviews_select on public.reviews for select to anon, authenticated
  using (status = 'visible' or user_id = auth.uid() or public.is_admin());
drop policy if exists reviews_insert on public.reviews;
create policy reviews_insert on public.reviews for insert to authenticated with check (user_id = auth.uid());
drop policy if exists reviews_update_own on public.reviews;
create policy reviews_update_own on public.reviews for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists reviews_delete_own on public.reviews;
create policy reviews_delete_own on public.reviews for delete to authenticated using (user_id = auth.uid());

drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments for select to anon, authenticated
  using (status = 'visible' or user_id = auth.uid() or public.is_admin());
drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments for insert to authenticated with check (user_id = auth.uid());
drop policy if exists comments_update_own on public.comments;
create policy comments_update_own on public.comments for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists comments_delete_own on public.comments;
create policy comments_delete_own on public.comments for delete to authenticated using (user_id = auth.uid());

drop policy if exists library_own on public.library;
create policy library_own on public.library for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists reports_select on public.reports;
create policy reports_select on public.reports for select to authenticated
  using (reporter_id = auth.uid() or public.is_admin());
drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert to authenticated with check (reporter_id = auth.uid());

-- ---------- 5. SERVER-SIDE ACTIONS (RPC) ------------------------------

-- Add or change my rating (1-5). Aggregates update automatically.
create or replace function public.rate_book(p_book text, p_rating int) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in required.' using errcode = '42501'; end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'Rating must be 1 to 5.'; end if;
  if (select count(*) from public.ratings where user_id = uid and updated_at > now() - interval '1 minute') >= 20 then
    raise exception 'Too many rating changes. Please wait a minute.';
  end if;
  insert into public.ratings (user_id, book_id, rating) values (uid, p_book, p_rating)
  on conflict (user_id, book_id) do update set rating = excluded.rating;
end $$;

-- Admin: hide, show or delete a comment or review.
create or replace function public.moderate_content(p_kind text, p_id uuid, p_action text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if p_kind not in ('comment','review') or p_action not in ('hide','show','delete') then
    raise exception 'Bad request.';
  end if;
  if p_kind = 'comment' then
    if p_action = 'delete' then delete from public.comments where id = p_id;
    else update public.comments set status = case p_action when 'hide' then 'hidden' else 'visible' end where id = p_id; end if;
  else
    if p_action = 'delete' then delete from public.reviews where id = p_id;
    else update public.reviews set status = case p_action when 'hide' then 'hidden' else 'visible' end where id = p_id; end if;
  end if;
end $$;

-- Admin: close a report.
create or replace function public.resolve_report(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if p_status not in ('resolved','dismissed') then raise exception 'Bad status.'; end if;
  update public.reports set status = p_status, handled_by = auth.uid() where id = p_id;
end $$;

-- Admin: basic numbers.
create or replace function public.admin_stats() returns json
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return json_build_object(
    'users', (select count(*) from public.profiles),
    'ratings', (select count(*) from public.ratings),
    'reviews', (select count(*) from public.reviews),
    'comments', (select count(*) from public.comments),
    'open_reports', (select count(*) from public.reports where status = 'open'));
end $$;

-- Delete my own account. Ratings and library are deleted; reviews and
-- comments stay but become anonymous ("Deleted reader").
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'Sign in required.' using errcode = '42501'; end if;
  delete from auth.users where id = auth.uid();
end $$;

revoke all on function public.rate_book(text, int) from public;
revoke all on function public.moderate_content(text, uuid, text) from public;
revoke all on function public.resolve_report(uuid, text) from public;
revoke all on function public.admin_stats() from public;
revoke all on function public.delete_my_account() from public;
grant execute on function public.rate_book(text, int) to authenticated;
grant execute on function public.moderate_content(text, uuid, text) to authenticated;
grant execute on function public.resolve_report(uuid, text) to authenticated;
grant execute on function public.admin_stats() to authenticated;
grant execute on function public.delete_my_account() to authenticated;

-- ---------- 6. BOOK CATALOG (stable ids used by the website) ----------

insert into public.books (id, title, author, genre) values
  ('glass-orchard',       'The Glass Orchard',   'Elena Voss',    'Fantasy'),
  ('ashes-and-crowns',    'Ashes & Crowns',      'Marcus Hale',   'Epic'),
  ('lantern-road',        'The Lantern Road',    'Iris Kandel',   'Adventure'),
  ('moonbound-vow',       'Moonbound Vow',       'Selene Archer', 'Romance'),
  ('fern-and-fable',      'Fern & Fable',        'Lucía Ortega',  'Folklore'),
  ('ninth-bell',          'The Ninth Bell',      'Tobias Wren',   'Mystery'),
  ('dragon-of-saltmere',  'Dragon of Saltmere',  'Noor Rahim',    'Epic'),
  ('starless-atlas',      'Starless Atlas',      'Kai Mercer',    'Adventure'),
  ('crowned-raven',       'The Crowned Raven',   'Edda Frost',    'Epic'),
  ('silver-tide-letters', 'Silver Tide Letters', 'Maren Holt',    'Romance'),
  ('mapmakers-gate',      'Mapmaker’s Gate',     'Orin Vale',     'Adventure'),
  ('hollow-crown-hymn',   'Hollow Crown Hymn',   'Zara Quill',    'Fantasy')
on conflict (id) do update
  set title = excluded.title, author = excluded.author, genre = excluded.genre;

-- ---------- 7. FIRST ADMIN (run manually, AFTER you have signed up) ---
-- Replace the email with the one you registered on the site, then run:
--
--   insert into public.admins (user_id)
--   select id from auth.users where email = 'YOUR_EMAIL_HERE'
--   on conflict do nothing;
--
-- Admin rights can only be granted here, in the SQL Editor. No website
-- button, URL or browser variable can create an admin.
