-- =====================================================================
-- Ui Books - PHASE 1: security foundation for the admin dashboard
-- Run ONCE in Supabase -> SQL Editor -> New query -> paste -> Run.
--
-- Safe by design:
--   * Everything runs inside one transaction: if any line fails, NOTHING
--     is changed and you can just send me the error text.
--   * It only ADDS things (tables, columns, functions) and REPLACES old
--     policies/functions with stricter versions. No book, chapter,
--     comment, review, rating or user is deleted.
--   * Your 12 books stay published and visible. The website keeps working.
--   * The owner (the account in public.admins) keeps full control.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. BOOKS: new columns (publish switch, comment switch, order, artwork)
-- ---------------------------------------------------------------------
-- Existing books are kept published; NEW books default to draft.
alter table public.books add column if not exists published boolean not null default true;
alter table public.books alter column published set default false;
alter table public.books add column if not exists comments_enabled boolean not null default true;
alter table public.books add column if not exists sort_order integer not null default 0;
alter table public.books add column if not exists art jsonb;
alter table public.books add column if not exists updated_at timestamptz not null default now();

-- Give the 12 seed books their current on-site order (only where still 0).
update public.books b set sort_order = x.n
from (values
  ('glass-orchard',1),('ashes-and-crowns',2),('lantern-road',3),('moonbound-vow',4),
  ('fern-and-fable',5),('ninth-bell',6),('dragon-of-saltmere',7),('starless-atlas',8),
  ('crowned-raven',9),('silver-tide-letters',10),('mapmakers-gate',11),('hollow-crown-hymn',12)
) as x(id, n)
where b.id = x.id and b.sort_order = 0;

-- Basic data-quality limits (apply to new/edited rows; "not valid" = do not
-- re-check old rows, so this can never fail on existing data).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'books_cover_url_https') then
    alter table public.books add constraint books_cover_url_https
      check (cover_url is null or cover_url ~ '^https://') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'books_text_lengths') then
    alter table public.books add constraint books_text_lengths
      check (char_length(title) between 1 and 120
         and char_length(author) between 1 and 80
         and char_length(genre) between 1 and 40
         and char_length(description) <= 4000) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. ROLES AND PERMISSIONS (data only; the owner stays in public.admins)
-- ---------------------------------------------------------------------
create table if not exists public.permissions (
  key   text primary key,
  label text not null,
  grp   text not null
);

create table if not exists public.roles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (char_length(btrim(name)) between 2 and 40),
  description text not null default '',
  is_system   boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.role_permissions (
  role_id    uuid not null references public.roles(id) on delete cascade,
  permission text not null references public.permissions(key) on delete cascade,
  primary key (role_id, permission)
);

create table if not exists public.user_roles (
  user_id    uuid not null references auth.users(id) on delete cascade,
  role_id    uuid not null references public.roles(id) on delete cascade,
  granted_by uuid,
  granted_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

create table if not exists public.user_permissions (
  user_id    uuid not null references auth.users(id) on delete cascade,
  permission text not null references public.permissions(key) on delete cascade,
  granted_by uuid,
  granted_at timestamptz not null default now(),
  primary key (user_id, permission)
);

create table if not exists public.staff_suspensions (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  reason       text not null default '',
  suspended_by uuid,
  suspended_at timestamptz not null default now()
);

insert into public.permissions (key, label, grp) values
  ('books.create',      'Create books',                 'Books'),
  ('books.edit',        'Edit book details',            'Books'),
  ('books.delete',      'Delete books',                 'Books'),
  ('books.publish',     'Publish / unpublish books',    'Books'),
  ('chapters.create',   'Add chapters',                 'Chapters'),
  ('chapters.edit',     'Edit and reorder chapters',    'Chapters'),
  ('chapters.delete',   'Delete chapters',              'Chapters'),
  ('covers.upload',     'Upload, replace, remove covers','Covers'),
  ('comments.view',     'View all comments, reviews, reports', 'Community'),
  ('comments.moderate', 'Hide / restore comments, close comments on a book', 'Community'),
  ('comments.delete',   'Delete comments and reviews',  'Community'),
  ('settings.manage',   'Change website settings and widgets', 'Website'),
  ('users.manage',      'Manage staff accounts',        'Staff'),
  ('roles.manage',      'Create and edit roles',        'Staff'),
  ('logs.view',         'View the audit log',           'Staff')
on conflict (key) do update set label = excluded.label, grp = excluded.grp;

insert into public.roles (name, description, is_system) values
  ('Administrator',     'Manages books, chapters, covers, comments and settings.', true),
  ('Book Editor',       'Writes and edits books and chapters. Cannot publish or delete.', true),
  ('Comment Moderator', 'Reviews, hides and removes comments and reviews.', true)
on conflict (name) do nothing;

-- Starting permissions for the three built-in roles (only on the very first run,
-- so a re-run can never undo changes you make later in the dashboard).
insert into public.role_permissions (role_id, permission)
select r.id, v.perm
from (values
  ('Administrator','books.create'),('Administrator','books.edit'),('Administrator','books.delete'),
  ('Administrator','books.publish'),('Administrator','chapters.create'),('Administrator','chapters.edit'),
  ('Administrator','chapters.delete'),('Administrator','covers.upload'),('Administrator','comments.view'),
  ('Administrator','comments.moderate'),('Administrator','comments.delete'),('Administrator','settings.manage'),
  ('Book Editor','books.create'),('Book Editor','books.edit'),('Book Editor','chapters.create'),
  ('Book Editor','chapters.edit'),('Book Editor','covers.upload'),
  ('Comment Moderator','comments.view'),('Comment Moderator','comments.moderate'),
  ('Comment Moderator','comments.delete')
) as v(role_name, perm)
join public.roles r on r.name = v.role_name
where not exists (select 1 from public.role_permissions)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 3. SITE SETTINGS (public-readable; changed only through a checked function)
-- ---------------------------------------------------------------------
create table if not exists public.site_settings (
  key        text primary key check (key ~ '^[a-z0-9_]{1,40}$'),
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into public.site_settings (key, value) values
  ('features',        '{"comments": true, "reviews": true}'::jsonb),
  ('floating_widget', '{"enabled": false, "label": "", "url": "", "position": "left", "style": "gold"}'::jsonb),
  ('theme_toggle',    '{"enabled": true}'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 4. AUDIT LOG (append-only; only people with logs.view can read it)
-- ---------------------------------------------------------------------
create table if not exists public.admin_audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_id    uuid,
  actor_name  text,
  action      text not null,
  target_type text,
  target_id   text,
  details     jsonb not null default '{}'::jsonb
);
create index if not exists admin_audit_log_at_idx on public.admin_audit_log (at desc);

create or replace function public.audit_log_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'The audit log cannot be changed.';
end $$;

drop trigger if exists audit_log_no_change on public.admin_audit_log;
create trigger audit_log_no_change before update or delete on public.admin_audit_log
  for each row execute function public.audit_log_immutable();

-- ---------------------------------------------------------------------
-- 5. LOCK DOWN TABLE ACCESS (Supabase gives new tables broad default access)
-- ---------------------------------------------------------------------
alter table public.permissions      enable row level security;
alter table public.roles            enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles       enable row level security;
alter table public.user_permissions enable row level security;
alter table public.staff_suspensions enable row level security;
alter table public.site_settings    enable row level security;
alter table public.admin_audit_log  enable row level security;

revoke all on table public.permissions, public.roles, public.role_permissions,
  public.user_roles, public.user_permissions, public.staff_suspensions,
  public.site_settings, public.admin_audit_log from anon, authenticated;

grant select on table public.site_settings to anon, authenticated;
grant select on table public.admin_audit_log to authenticated;

-- Chapters were over-granted by Supabase defaults (anon had insert/delete/truncate).
-- Row-level security already blocked misuse; this removes the extra rights too.
revoke all on table public.book_chapters from anon, authenticated;
grant select on table public.book_chapters to anon, authenticated;
grant insert, update, delete on table public.book_chapters to authenticated;

-- ---------------------------------------------------------------------
-- 6. PERMISSION FUNCTIONS
-- ---------------------------------------------------------------------
-- is_admin() stays exactly as it is: it means "the owner".

create or replace function public.has_permission(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or (
        auth.uid() is not null
        and not exists (select 1 from public.staff_suspensions s where s.user_id = auth.uid())
        and (
          exists (select 1 from public.user_permissions up
                  where up.user_id = auth.uid() and up.permission = p)
          or exists (select 1 from public.user_roles ur
                     join public.role_permissions rp on rp.role_id = ur.role_id
                     where ur.user_id = auth.uid() and rp.permission = p)
        )
      );
$$;

create or replace function public.can_see_drafts() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_permission('books.create')   or public.has_permission('books.edit')
      or public.has_permission('books.publish')  or public.has_permission('books.delete')
      or public.has_permission('chapters.create') or public.has_permission('chapters.edit')
      or public.has_permission('chapters.delete') or public.has_permission('covers.upload');
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.permissions p where public.has_permission(p.key));
$$;

create or replace function public.feature_on(f text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case when jsonb_typeof(s.value -> f) = 'boolean' then (s.value ->> f)::boolean end
       from public.site_settings s where s.key = 'features'),
    true);
$$;

-- What can the signed-in person do? (used by the dashboard to show the right screens)
create or replace function public.admin_me() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'owner', public.is_admin(),
    'suspended', exists (select 1 from public.staff_suspensions where user_id = auth.uid()),
    'permissions', coalesce(
      (select json_agg(p.key order by p.key) from public.permissions p where public.has_permission(p.key)),
      '[]'::json)
  );
$$;

-- Internal helper that writes the audit log. Nobody can call it from the website.
create or replace function public.write_audit(p_action text, p_type text, p_target text, p_details jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); nm text;
begin
  if uid is not null then
    select display_name into nm from public.profiles where id = uid;
  end if;
  insert into public.admin_audit_log (actor_id, actor_name, action, target_type, target_id, details)
  values (uid, nm, p_action, p_type, p_target, coalesce(p_details, '{}'::jsonb));
end $$;

-- ---------------------------------------------------------------------
-- 7. GUARDS AND AUTOMATIC AUDIT TRIGGERS
-- ---------------------------------------------------------------------
-- Field-level rules for books (database-enforced, not just hidden buttons).
create or replace function public.guard_books() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  -- SQL Editor / internal maintenance (no signed-in user): allowed.
  if auth.uid() is null then return new; end if;

  if tg_op = 'INSERT' then
    if new.published and not public.has_permission('books.publish') then
      raise exception 'You do not have permission to publish books.' using errcode = '42501';
    end if;
    if (new.cover_url is not null or new.cover_path is not null) and not public.has_permission('covers.upload') then
      raise exception 'You do not have permission to set covers.' using errcode = '42501';
    end if;
    if not new.comments_enabled and not public.has_permission('comments.moderate') then
      raise exception 'You do not have permission to close comments.' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.id <> old.id then
    raise exception 'A book id can never be changed.';
  end if;
  if new.published is distinct from old.published and not public.has_permission('books.publish') then
    raise exception 'You do not have permission to publish or unpublish books.' using errcode = '42501';
  end if;
  if new.comments_enabled is distinct from old.comments_enabled and not public.has_permission('comments.moderate') then
    raise exception 'You do not have permission to open or close comments.' using errcode = '42501';
  end if;
  if (new.cover_url is distinct from old.cover_url or new.cover_path is distinct from old.cover_path)
     and not public.has_permission('covers.upload') then
    raise exception 'You do not have permission to change covers.' using errcode = '42501';
  end if;
  if (new.title is distinct from old.title or new.author is distinct from old.author
      or new.genre is distinct from old.genre or new.description is distinct from old.description
      or new.sort_order is distinct from old.sort_order or new.art is distinct from old.art)
     and not public.has_permission('books.edit') then
    raise exception 'You do not have permission to edit book details.' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists books_guard on public.books;
create trigger books_guard before insert or update on public.books
  for each row execute function public.guard_books();

drop trigger if exists chapters_touch on public.book_chapters;
create trigger chapters_touch before update on public.book_chapters
  for each row execute function public.touch_updated_at();

-- Automatic audit entries for books and chapters (cannot be skipped from the browser).
create or replace function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare act text; tt text; tid text; det jsonb := '{}'::jsonb; changed jsonb;
begin
  if auth.uid() is null then return null; end if;
  if current_setting('app.skip_audit', true) = '1' then return null; end if;

  if tg_table_name = 'books' then
    tt := 'book';
    if tg_op = 'INSERT' then
      act := 'book.create'; tid := new.id; det := jsonb_build_object('title', new.title);
    elsif tg_op = 'DELETE' then
      act := 'book.delete'; tid := old.id; det := jsonb_build_object('title', old.title);
    else
      tid := new.id;
      select coalesce(jsonb_agg(n.key order by n.key), '[]'::jsonb) into changed
        from jsonb_each(to_jsonb(new)) as n(key, value)
        where n.key <> 'updated_at' and (to_jsonb(old) -> n.key) is distinct from n.value;
      if jsonb_array_length(changed) = 0 then return null; end if;
      if changed @> '["published"]'::jsonb then
        act := case when new.published then 'book.publish' else 'book.unpublish' end;
      elsif changed <@ '["cover_path","cover_url"]'::jsonb then
        act := 'book.cover';
      elsif changed = '["comments_enabled"]'::jsonb then
        act := 'book.comments';
      else
        act := 'book.update';
      end if;
      det := jsonb_build_object('title', new.title, 'changed', changed);
    end if;
  else
    tt := 'chapter';
    if tg_op = 'INSERT' then
      act := 'chapter.create'; tid := new.id::text;
      det := jsonb_build_object('book_id', new.book_id, 'chapter_number', new.chapter_number, 'title', new.title);
    elsif tg_op = 'DELETE' then
      -- If the whole book was deleted, the book.delete entry already covers it.
      if not exists (select 1 from public.books where id = old.book_id) then return null; end if;
      act := 'chapter.delete'; tid := old.id::text;
      det := jsonb_build_object('book_id', old.book_id, 'chapter_number', old.chapter_number, 'title', old.title);
    else
      tid := new.id::text;
      select coalesce(jsonb_agg(n.key order by n.key), '[]'::jsonb) into changed
        from jsonb_each(to_jsonb(new)) as n(key, value)
        where n.key <> 'updated_at' and (to_jsonb(old) -> n.key) is distinct from n.value;
      if jsonb_array_length(changed) = 0 then return null; end if;
      act := case when changed = '["chapter_number"]'::jsonb then 'chapter.reorder' else 'chapter.update' end;
      det := jsonb_build_object('book_id', new.book_id, 'title', new.title, 'changed', changed);
    end if;
  end if;

  perform public.write_audit(act, tt, tid, det);
  return null;
end $$;

drop trigger if exists books_audit on public.books;
create trigger books_audit after insert or update or delete on public.books
  for each row execute function public.audit_row_change();

drop trigger if exists chapters_audit on public.book_chapters;
create trigger chapters_audit after insert or update or delete on public.book_chapters
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------
-- 8. OWNER PROTECTION
-- ---------------------------------------------------------------------
create or replace function public.protect_owner() returns trigger
language plpgsql as $$
begin
  raise exception 'The owner account is protected and cannot be removed here.';
end $$;

drop trigger if exists admins_protect on public.admins;
create trigger admins_protect before delete on public.admins
  for each row execute function public.protect_owner();

create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'Sign in required.' using errcode = '42501'; end if;
  if public.is_admin() then
    raise exception 'The owner account cannot be deleted here.' using errcode = '42501';
  end if;
  delete from auth.users where id = auth.uid();
end $$;

-- ---------------------------------------------------------------------
-- 9. ACCESS POLICIES (replace the old owner-only policies)
-- ---------------------------------------------------------------------
-- Books: visitors see published books; staff also see drafts.
drop policy if exists books_read         on public.books;
drop policy if exists books_admin_insert on public.books;
drop policy if exists books_admin_update on public.books;
drop policy if exists books_admin_delete on public.books;
drop policy if exists books_select on public.books;
drop policy if exists books_insert on public.books;
drop policy if exists books_update on public.books;
drop policy if exists books_delete on public.books;

create policy books_select on public.books for select to anon, authenticated
  using (published or (select public.can_see_drafts()));
create policy books_insert on public.books for insert to authenticated
  with check ((select public.has_permission('books.create')));
create policy books_update on public.books for update to authenticated
  using ((select public.has_permission('books.edit')) or (select public.has_permission('books.publish'))
         or (select public.has_permission('covers.upload')))
  with check ((select public.has_permission('books.edit')) or (select public.has_permission('books.publish'))
         or (select public.has_permission('covers.upload')));
create policy books_delete on public.books for delete to authenticated
  using ((select public.has_permission('books.delete')));

-- Chapters: only readable when the book is published (or for staff).
drop policy if exists chapters_public_read   on public.book_chapters;
drop policy if exists chapters_admin_insert  on public.book_chapters;
drop policy if exists chapters_admin_update  on public.book_chapters;
drop policy if exists chapters_admin_delete  on public.book_chapters;
drop policy if exists chapters_select on public.book_chapters;
drop policy if exists chapters_insert on public.book_chapters;
drop policy if exists chapters_update on public.book_chapters;
drop policy if exists chapters_delete on public.book_chapters;

create policy chapters_select on public.book_chapters for select to anon, authenticated
  using (exists (select 1 from public.books b where b.id = book_chapters.book_id and b.published)
         or (select public.can_see_drafts()));
create policy chapters_insert on public.book_chapters for insert to authenticated
  with check ((select public.has_permission('chapters.create')));
create policy chapters_update on public.book_chapters for update to authenticated
  using ((select public.has_permission('chapters.edit')))
  with check ((select public.has_permission('chapters.edit')));
create policy chapters_delete on public.book_chapters for delete to authenticated
  using ((select public.has_permission('chapters.delete')));

-- Comments: hidden comments and comments on unpublished books stay private;
-- posting needs comments switched on (site-wide and for that book).
drop policy if exists comments_select on public.comments;
drop policy if exists comments_insert on public.comments;

create policy comments_select on public.comments for select to anon, authenticated
  using ((status = 'visible'
          and exists (select 1 from public.books b where b.id = comments.book_id and b.published))
         or user_id = auth.uid()
         or (select public.has_permission('comments.view')));
create policy comments_insert on public.comments for insert to authenticated
  with check (user_id = auth.uid()
              and (select public.feature_on('comments'))
              and exists (select 1 from public.books b
                          where b.id = comments.book_id and b.published and b.comments_enabled));

-- Reviews: same idea.
drop policy if exists reviews_select on public.reviews;
drop policy if exists reviews_insert on public.reviews;

create policy reviews_select on public.reviews for select to anon, authenticated
  using ((status = 'visible'
          and exists (select 1 from public.books b where b.id = reviews.book_id and b.published))
         or user_id = auth.uid()
         or (select public.has_permission('comments.view')));
create policy reviews_insert on public.reviews for insert to authenticated
  with check (user_id = auth.uid()
              and (select public.feature_on('reviews'))
              and exists (select 1 from public.books b where b.id = reviews.book_id and b.published));

-- Reports: reporters see their own; moderators see all.
drop policy if exists reports_select on public.reports;
create policy reports_select on public.reports for select to authenticated
  using (reporter_id = auth.uid() or (select public.has_permission('comments.view')));

-- Settings: everyone can read (they are public website options, never secrets).
drop policy if exists settings_read on public.site_settings;
create policy settings_read on public.site_settings for select to anon, authenticated using (true);

-- Audit log: readable only with logs.view. Nobody can write to it from the browser.
drop policy if exists audit_read on public.admin_audit_log;
create policy audit_read on public.admin_audit_log for select to authenticated
  using ((select public.has_permission('logs.view')));

-- Public statistics views: hide unpublished books (these views are meant to
-- bypass the private ratings table, so they filter by published themselves).
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
where b.published or public.can_see_drafts()
group by b.id;

create or replace view public.review_feed as
select rv.id, rv.book_id, rv.user_id, rv.body, rv.created_at, rv.edited_at,
       p.display_name, p.avatar_url, r.rating
from public.reviews rv
join public.books b on b.id = rv.book_id
left join public.profiles p on p.id = rv.user_id
left join public.ratings r on r.book_id = rv.book_id and r.user_id = rv.user_id
where rv.status = 'visible' and (b.published or public.can_see_drafts());

-- Cover storage: permission-based, with size and type limits.
drop policy if exists covers_admin_upload on storage.objects;
drop policy if exists covers_admin_update on storage.objects;
drop policy if exists covers_admin_delete on storage.objects;
drop policy if exists covers_upload on storage.objects;
drop policy if exists covers_update on storage.objects;
drop policy if exists covers_delete on storage.objects;

create policy covers_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'book-covers' and (select public.has_permission('covers.upload')));
create policy covers_update on storage.objects for update to authenticated
  using (bucket_id = 'book-covers' and (select public.has_permission('covers.upload')))
  with check (bucket_id = 'book-covers' and (select public.has_permission('covers.upload')));
create policy covers_delete on storage.objects for delete to authenticated
  using (bucket_id = 'book-covers' and (select public.has_permission('covers.upload')));

update storage.buckets
   set file_size_limit = 3145728,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'book-covers';

-- ---------------------------------------------------------------------
-- 10. SERVER-SIDE ACTIONS (RPC) used by the dashboard
-- ---------------------------------------------------------------------
-- Hide / show / delete a comment or review (now permission-based and logged).
create or replace function public.moderate_content(p_kind text, p_id uuid, p_action text) returns void
language plpgsql security definer set search_path = public as $$
declare bid text; aid uuid;
begin
  if p_kind not in ('comment','review') or p_action not in ('hide','show','delete') then
    raise exception 'Bad request.';
  end if;
  if p_action = 'delete' then
    if not public.has_permission('comments.delete') then
      raise exception 'Not allowed.' using errcode = '42501';
    end if;
  else
    if not public.has_permission('comments.moderate') then
      raise exception 'Not allowed.' using errcode = '42501';
    end if;
  end if;

  if p_kind = 'comment' then
    select book_id, user_id into bid, aid from public.comments where id = p_id;
    if not found then raise exception 'Not found.'; end if;
    if p_action = 'delete' then delete from public.comments where id = p_id;
    else update public.comments set status = case p_action when 'hide' then 'hidden' else 'visible' end where id = p_id; end if;
  else
    select book_id, user_id into bid, aid from public.reviews where id = p_id;
    if not found then raise exception 'Not found.'; end if;
    if p_action = 'delete' then delete from public.reviews where id = p_id;
    else update public.reviews set status = case p_action when 'hide' then 'hidden' else 'visible' end where id = p_id; end if;
  end if;

  perform public.write_audit(p_kind || '.' || p_action, p_kind, p_id::text,
    jsonb_build_object('book_id', bid, 'author_id', aid));
end $$;

create or replace function public.resolve_report(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('comments.moderate') then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_status not in ('resolved','dismissed') then raise exception 'Bad status.'; end if;
  update public.reports set status = p_status, handled_by = auth.uid() where id = p_id;
  if not found then raise exception 'Not found.'; end if;
  perform public.write_audit('report.' || p_status, 'report', p_id::text, '{}'::jsonb);
end $$;

create or replace function public.admin_stats() returns json
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return json_build_object(
    'users', (select count(*) from public.profiles),
    'ratings', (select count(*) from public.ratings),
    'reviews', (select count(*) from public.reviews),
    'comments', (select count(*) from public.comments),
    'open_reports', (select count(*) from public.reports where status = 'open'));
end $$;

-- Open or close comments on one book (for moderators who cannot edit books).
create or replace function public.admin_set_book_comments(p_book text, p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('comments.moderate') then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  update public.books set comments_enabled = p_enabled where id = p_book;
  if not found then raise exception 'Book not found.'; end if;
end $$;

-- Put a book's chapters in a new order (list of chapter ids, first to last).
create or replace function public.admin_reorder_chapters(p_book text, p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.has_permission('chapters.edit') then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select count(*) into n from public.book_chapters where book_id = p_book;
  if p_ids is null
     or coalesce(array_length(p_ids, 1), 0) <> n
     or (select count(distinct x) from unnest(p_ids) as x) <> n
     or exists (select 1 from unnest(p_ids) as x
                where not exists (select 1 from public.book_chapters c where c.id = x and c.book_id = p_book)) then
    raise exception 'The chapter list does not match this book.';
  end if;
  perform set_config('app.skip_audit', '1', true);
  update public.book_chapters set chapter_number = chapter_number + 100000 where book_id = p_book;
  update public.book_chapters c set chapter_number = o.ord::int
    from unnest(p_ids) with ordinality as o(id, ord)
    where c.id = o.id and c.book_id = p_book;
  perform set_config('app.skip_audit', '0', true);
  perform public.write_audit('chapter.reorder', 'book', p_book, jsonb_build_object('order', to_jsonb(p_ids)));
end $$;

-- Change one website setting (checked and logged).
create or replace function public.admin_set_setting(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare u text;
begin
  if not public.has_permission('settings.manage') then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_key not in ('features', 'floating_widget', 'theme_toggle') then
    raise exception 'Unknown setting.';
  end if;
  if p_value is null or jsonb_typeof(p_value) <> 'object' or pg_column_size(p_value) > 4000 then
    raise exception 'Bad value.';
  end if;
  if p_key = 'features' and exists (select 1 from jsonb_each(p_value) e where jsonb_typeof(e.value) <> 'boolean') then
    raise exception 'Feature switches must be on or off.';
  end if;
  if p_key = 'floating_widget' then
    u := coalesce(p_value ->> 'url', '');
    if u <> '' and u !~ '^(https://|#)' then
      raise exception 'The link must start with https:// or #.';
    end if;
    if char_length(coalesce(p_value ->> 'label', '')) > 40 then
      raise exception 'The label is too long (40 characters max).';
    end if;
  end if;
  insert into public.site_settings (key, value, updated_by) values (p_key, p_value, auth.uid())
  on conflict (key) do update
    set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
  perform public.write_audit('settings.update', 'setting', p_key, jsonb_build_object('value', p_value));
end $$;

-- ---------------------------------------------------------------------
-- 11. WHO MAY CALL WHAT (functions are open to everyone by default; fix that)
-- ---------------------------------------------------------------------
revoke all on function public.has_permission(text)               from public, anon, authenticated;
revoke all on function public.can_see_drafts()                   from public, anon, authenticated;
revoke all on function public.feature_on(text)                   from public, anon, authenticated;
revoke all on function public.is_staff()                         from public, anon, authenticated;
revoke all on function public.admin_me()                         from public, anon, authenticated;
revoke all on function public.write_audit(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.guard_books()                      from public, anon, authenticated;
revoke all on function public.audit_row_change()                 from public, anon, authenticated;
revoke all on function public.audit_log_immutable()              from public, anon, authenticated;
revoke all on function public.protect_owner()                    from public, anon, authenticated;
revoke all on function public.admin_set_book_comments(text, boolean) from public, anon, authenticated;
revoke all on function public.admin_reorder_chapters(text, uuid[])   from public, anon, authenticated;
revoke all on function public.admin_set_setting(text, jsonb)     from public, anon, authenticated;
revoke all on function public.moderate_content(text, uuid, text) from public, anon, authenticated;
revoke all on function public.resolve_report(uuid, text)         from public, anon, authenticated;
revoke all on function public.admin_stats()                      from public, anon, authenticated;
revoke all on function public.delete_my_account()                from public, anon, authenticated;
revoke all on function public.rate_book(text, integer)           from public, anon, authenticated;

-- Used inside access policies, so visitors must be able to run them.
grant execute on function public.has_permission(text) to anon, authenticated;
grant execute on function public.can_see_drafts()     to anon, authenticated;
grant execute on function public.feature_on(text)     to anon, authenticated;

-- Signed-in only (each one checks permission again inside).
grant execute on function public.admin_me()                          to authenticated;
grant execute on function public.admin_set_book_comments(text, boolean) to authenticated;
grant execute on function public.admin_reorder_chapters(text, uuid[])   to authenticated;
grant execute on function public.admin_set_setting(text, jsonb)      to authenticated;
grant execute on function public.moderate_content(text, uuid, text)  to authenticated;
grant execute on function public.resolve_report(uuid, text)          to authenticated;
grant execute on function public.admin_stats()                       to authenticated;
grant execute on function public.delete_my_account()                 to authenticated;
grant execute on function public.rate_book(text, integer)            to authenticated;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- RESULT CHECK: copy the single result cell below and send it to me.
-- ---------------------------------------------------------------------
select jsonb_build_object(
  'books_total',          (select count(*) from public.books),
  'books_published',      (select count(*) from public.books where published),
  'roles',                (select count(*) from public.roles),
  'permissions',          (select count(*) from public.permissions),
  'role_permission_rows', (select count(*) from public.role_permissions),
  'settings',             (select count(*) from public.site_settings),
  'policies_on_books',    (select count(*) from pg_policies where schemaname = 'public' and tablename = 'books'),
  'cover_size_limit',     (select file_size_limit from storage.buckets where id = 'book-covers')
)::text as phase1_result;
