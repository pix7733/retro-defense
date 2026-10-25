-- Retro Defense: schema + RPC API
-- Tables live in private schema "fb" (not exposed through the REST API).
-- The browser only calls the public.fb_* functions below, which check a session token.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists fb;
revoke all on schema fb from public, anon, authenticated;

create table if not exists fb.settings (
  key   text primary key,
  value text not null
);

create table if not exists fb.players (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  name_key      text not null unique,          -- lower(trim(name)) for login
  position      text not null,
  pin_hash      text not null,
  is_admin      boolean not null default false,
  failed_logins int not null default 0,
  locked_until  timestamptz,
  created_at    timestamptz not null default now(),
  last_seen     timestamptz not null default now()
);

create table if not exists fb.sessions (
  token      uuid primary key default gen_random_uuid(),
  player_id  uuid not null references fb.players(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '120 days'
);
create index if not exists sessions_player_idx on fb.sessions(player_id);

create table if not exists fb.questions (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('rule','team')),
  category    text not null default 'General',
  prompt      text not null,
  choices     jsonb not null,                  -- ["A","B","C","D"]
  answer      int  not null,                   -- index into choices
  explanation text not null default '',
  positions   text[] not null default '{}',    -- empty = everyone
  player_ids  uuid[] not null default '{}',    -- optional: specific players only
  scenario    jsonb,                           -- {"formation":"trips","strength":"right","motion":"H"}
  active      boolean not null default true,
  expires_on  date,
  created_by  uuid references fb.players(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (jsonb_typeof(choices) = 'array' and jsonb_array_length(choices) between 2 and 4),
  check (answer >= 0 and answer < jsonb_array_length(choices))
);

create table if not exists fb.attempts (
  id          bigint generated always as identity primary key,
  player_id   uuid not null references fb.players(id) on delete cascade,
  question_id uuid not null references fb.questions(id) on delete cascade,
  correct     boolean not null,
  ms          int,
  mode        text not null default 'game',
  created_at  timestamptz not null default now()
);
create index if not exists attempts_player_idx on fb.attempts(player_id);
create index if not exists attempts_question_idx on fb.attempts(question_id);

create table if not exists fb.games (
  id             bigint generated always as identity primary key,
  player_id      uuid not null references fb.players(id) on delete cascade,
  score          int not null,
  correct        int not null,
  total          int not null,
  stops          int not null,
  points_allowed int not null,
  created_at     timestamptz not null default now()
);
create index if not exists games_player_idx on fb.games(player_id);

alter table fb.settings  enable row level security;
alter table fb.players   enable row level security;
alter table fb.sessions  enable row level security;
alter table fb.questions enable row level security;
alter table fb.attempts  enable row level security;
alter table fb.games     enable row level security;

-- ---------- helpers (not callable from the browser) ----------

create or replace function fb.valid_positions() returns text[]
language sql immutable set search_path = '' as $$
  select array['Left End','Right End','Mike','Will','Star','Bama','3 Tech','1 Tech','Corner','Free Safety']
$$;

create or replace function fb.player_for(p_token uuid) returns fb.players
language plpgsql security definer set search_path = '' as $$
declare v fb.players;
begin
  select p.* into v
  from fb.sessions s join fb.players p on p.id = s.player_id
  where s.token = p_token and s.expires_at > now();
  if v.id is null then
    raise exception 'Session expired. Log in again.' using errcode = '28000';
  end if;
  update fb.players set last_seen = now() where id = v.id;
  return v;
end $$;

create or replace function fb.admin_for(p_token uuid) returns fb.players
language plpgsql security definer set search_path = '' as $$
declare v fb.players;
begin
  v := fb.player_for(p_token);
  if not v.is_admin then
    raise exception 'Coach access required.' using errcode = '42501';
  end if;
  return v;
end $$;

create or replace function fb.player_json(v fb.players) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', v.id, 'name', v.name, 'position', v.position, 'is_admin', v.is_admin)
$$;

-- ---------- public API ----------

create or replace function public.fb_register(
  p_name text, p_position text, p_pin text, p_team_code text, p_coach_code text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := btrim(p_name);
  v_admin boolean := false;
  v fb.players;
  v_token uuid;
begin
  if p_team_code is null or upper(btrim(p_team_code)) <> (select upper(value) from fb.settings where key = 'team_code') then
    raise exception 'Wrong team code. Ask your coach.';
  end if;
  if length(v_name) < 2 or length(v_name) > 40 then
    raise exception 'Name must be 2 to 40 characters.';
  end if;
  if p_position is null or not (p_position = any(fb.valid_positions())) then
    raise exception 'Pick a position.';
  end if;
  if p_pin !~ '^[0-9]{4,6}$' then
    raise exception 'PIN must be 4 to 6 digits.';
  end if;
  if exists (select 1 from fb.players where name_key = lower(v_name)) then
    raise exception 'That name is taken. Add your last initial or jersey number.';
  end if;
  if p_coach_code is not null and btrim(p_coach_code) <> '' then
    if btrim(p_coach_code) = (select value from fb.settings where key = 'coach_code') then
      v_admin := true;
    else
      raise exception 'Wrong coach code.';
    end if;
  end if;

  insert into fb.players(name, name_key, position, pin_hash, is_admin)
  values (v_name, lower(v_name), p_position, extensions.crypt(p_pin, extensions.gen_salt('bf')), v_admin)
  returning * into v;

  insert into fb.sessions(player_id) values (v.id) returning token into v_token;
  return jsonb_build_object('token', v_token, 'player', fb.player_json(v));
end $$;

create or replace function public.fb_login(p_name text, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v fb.players; v_token uuid;
begin
  select * into v from fb.players where name_key = lower(btrim(p_name));
  if v.id is null then
    raise exception 'Name or PIN is wrong.';
  end if;
  if v.locked_until is not null and v.locked_until > now() then
    raise exception 'Too many tries. Wait 5 minutes or ask your coach to reset your PIN.';
  end if;
  if v.pin_hash <> extensions.crypt(p_pin, v.pin_hash) then
    update fb.players
      set failed_logins = failed_logins + 1,
          locked_until = case when failed_logins + 1 >= 5 then now() + interval '5 minutes' else null end
      where id = v.id;
    raise exception 'Name or PIN is wrong.';
  end if;
  update fb.players set failed_logins = 0, locked_until = null, last_seen = now() where id = v.id;
  delete from fb.sessions where player_id = v.id and expires_at < now();
  insert into fb.sessions(player_id) values (v.id) returning token into v_token;
  return jsonb_build_object('token', v_token, 'player', fb.player_json(v));
end $$;

create or replace function public.fb_me(p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  return fb.player_json(fb.player_for(p_token));
end $$;

create or replace function public.fb_logout(p_token uuid) returns void
language sql security definer set search_path = '' as $$
  delete from fb.sessions where token = p_token;
$$;

-- Questions this player should see, with his personal miss history
create or replace function public.fb_get_questions(p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v fb.players;
begin
  v := fb.player_for(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', q.id, 'kind', q.kind, 'category', q.category, 'prompt', q.prompt,
      'choices', q.choices, 'answer', q.answer, 'explanation', q.explanation,
      'scenario', q.scenario,
      'seen', coalesce(a.seen, 0), 'missed', coalesce(a.missed, 0)
    ))
    from fb.questions q
    left join lateral (
      select count(*) seen, count(*) filter (where not correct) missed
      from fb.attempts where player_id = v.id and question_id = q.id
    ) a on true
    where q.active
      and (q.expires_on is null or q.expires_on >= current_date)
      and (cardinality(q.positions) = 0 or v.position = any(q.positions))
      and (cardinality(q.player_ids) = 0 or v.id = any(q.player_ids))
  ), '[]'::jsonb);
end $$;

-- p_attempts: [{"question_id": "...", "correct": true, "ms": 3200}, ...]
create or replace function public.fb_submit(
  p_token uuid, p_mode text, p_attempts jsonb, p_game jsonb default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v fb.players; v_best int;
begin
  v := fb.player_for(p_token);
  insert into fb.attempts(player_id, question_id, correct, ms, mode)
  select v.id, (x->>'question_id')::uuid, (x->>'correct')::boolean,
         least(greatest((x->>'ms')::int, 0), 600000), coalesce(p_mode, 'game')
  from jsonb_array_elements(coalesce(p_attempts, '[]'::jsonb)) x
  where exists (select 1 from fb.questions q where q.id = (x->>'question_id')::uuid);

  if p_game is not null then
    insert into fb.games(player_id, score, correct, total, stops, points_allowed)
    values (v.id,
            least(greatest((p_game->>'score')::int, 0), 100000),
            (p_game->>'correct')::int, (p_game->>'total')::int,
            (p_game->>'stops')::int, (p_game->>'points_allowed')::int);
  end if;
  select max(score) into v_best from fb.games where player_id = v.id;
  return jsonb_build_object('best', coalesce(v_best, 0));
end $$;

create or replace function public.fb_leaderboard(p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform fb.player_for(p_token);
  return coalesce((
    select jsonb_agg(row_to_json(t) order by t.best desc)
    from (
      select p.name, p.position,
             max(g.score) best, count(g.id) games,
             (select round(100.0 * count(*) filter (where correct) / nullif(count(*), 0))
                from fb.attempts a where a.player_id = p.id) accuracy
      from fb.players p join fb.games g on g.player_id = p.id
      group by p.id
      order by best desc
      limit 50
    ) t
  ), '[]'::jsonb);
end $$;

-- ---------- coach API ----------

create or replace function public.fb_admin_questions(p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform fb.admin_for(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', q.id, 'kind', q.kind, 'category', q.category, 'prompt', q.prompt,
      'choices', q.choices, 'answer', q.answer, 'explanation', q.explanation,
      'positions', q.positions, 'player_ids', q.player_ids, 'scenario', q.scenario,
      'active', q.active, 'expires_on', q.expires_on, 'updated_at', q.updated_at,
      'attempts', coalesce(a.n, 0), 'missed', coalesce(a.missed, 0)
    ) order by q.kind desc, q.updated_at desc)
    from fb.questions q
    left join lateral (
      select count(*) n, count(*) filter (where not correct) missed
      from fb.attempts where question_id = q.id
    ) a on true
  ), '[]'::jsonb);
end $$;

create or replace function public.fb_admin_save_question(p_token uuid, p_q jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v fb.players; v_id uuid := nullif(p_q->>'id', '')::uuid;
begin
  v := fb.admin_for(p_token);
  if v_id is null then
    insert into fb.questions(kind, category, prompt, choices, answer, explanation, positions, player_ids,
                             scenario, active, expires_on, created_by)
    values (p_q->>'kind', coalesce(nullif(p_q->>'category',''), 'General'), p_q->>'prompt', p_q->'choices',
            (p_q->>'answer')::int, coalesce(p_q->>'explanation',''),
            coalesce(array(select jsonb_array_elements_text(p_q->'positions')), '{}'),
            coalesce(array(select jsonb_array_elements_text(p_q->'player_ids'))::uuid[], '{}'),
            nullif(p_q->'scenario', 'null'::jsonb), coalesce((p_q->>'active')::boolean, true),
            nullif(p_q->>'expires_on','')::date, v.id)
    returning id into v_id;
  else
    update fb.questions set
      kind = p_q->>'kind',
      category = coalesce(nullif(p_q->>'category',''), 'General'),
      prompt = p_q->>'prompt',
      choices = p_q->'choices',
      answer = (p_q->>'answer')::int,
      explanation = coalesce(p_q->>'explanation',''),
      positions = coalesce(array(select jsonb_array_elements_text(p_q->'positions')), '{}'),
      player_ids = coalesce(array(select jsonb_array_elements_text(p_q->'player_ids'))::uuid[], '{}'),
      scenario = nullif(p_q->'scenario', 'null'::jsonb),
      active = coalesce((p_q->>'active')::boolean, true),
      expires_on = nullif(p_q->>'expires_on','')::date,
      updated_at = now()
    where id = v_id;
  end if;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.fb_admin_delete_question(p_token uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform fb.admin_for(p_token);
  delete from fb.questions where id = p_id;
end $$;

create or replace function public.fb_admin_players(p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform fb.admin_for(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'position', p.position, 'is_admin', p.is_admin,
      'last_seen', p.last_seen, 'created_at', p.created_at,
      'games', (select count(*) from fb.games g where g.player_id = p.id),
      'best', (select max(score) from fb.games g where g.player_id = p.id),
      'answered', (select count(*) from fb.attempts a where a.player_id = p.id),
      'correct', (select count(*) from fb.attempts a where a.player_id = p.id and a.correct),
      'team_answered', (select count(*) from fb.attempts a join fb.questions q on q.id = a.question_id
                         where a.player_id = p.id and q.kind = 'team'),
      'team_correct', (select count(*) from fb.attempts a join fb.questions q on q.id = a.question_id
                         where a.player_id = p.id and q.kind = 'team' and a.correct),
      'misses', coalesce((
         select jsonb_agg(m order by m->>'n' desc) from (
           select jsonb_build_object('prompt', q.prompt, 'n', count(*)) m
           from fb.attempts a join fb.questions q on q.id = a.question_id
           where a.player_id = p.id and not a.correct
           group by q.id order by count(*) desc limit 5) s), '[]'::jsonb)
    ) order by p.position, p.name)
    from fb.players p
  ), '[]'::jsonb);
end $$;

create or replace function public.fb_admin_update_player(
  p_token uuid, p_id uuid, p_position text default null, p_is_admin boolean default null, p_new_pin text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare v fb.players;
begin
  v := fb.admin_for(p_token);
  if p_position is not null and not (p_position = any(fb.valid_positions())) then
    raise exception 'Invalid position.';
  end if;
  if p_new_pin is not null and p_new_pin !~ '^[0-9]{4,6}$' then
    raise exception 'PIN must be 4 to 6 digits.';
  end if;
  if p_id = v.id and p_is_admin = false then
    raise exception 'You cannot remove your own coach access.';
  end if;
  update fb.players set
    position = coalesce(p_position, position),
    is_admin = coalesce(p_is_admin, is_admin),
    pin_hash = case when p_new_pin is null then pin_hash
                    else extensions.crypt(p_new_pin, extensions.gen_salt('bf')) end,
    failed_logins = case when p_new_pin is null then failed_logins else 0 end,
    locked_until = case when p_new_pin is null then locked_until else null end
  where id = p_id;
end $$;

create or replace function public.fb_admin_delete_player(p_token uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v fb.players;
begin
  v := fb.admin_for(p_token);
  if p_id = v.id then raise exception 'You cannot delete yourself.'; end if;
  delete from fb.players where id = p_id;
end $$;

create or replace function public.fb_admin_settings(p_token uuid, p_team_code text default null, p_coach_code text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform fb.admin_for(p_token);
  if p_team_code is not null and length(btrim(p_team_code)) >= 4 then
    update fb.settings set value = upper(btrim(p_team_code)) where key = 'team_code';
  end if;
  if p_coach_code is not null and length(btrim(p_coach_code)) >= 6 then
    update fb.settings set value = btrim(p_coach_code) where key = 'coach_code';
  end if;
  return (select jsonb_object_agg(key, value) from fb.settings);
end $$;

-- Lock down: only the fb_* API is callable from the browser.
revoke all on all functions in schema fb from public, anon, authenticated;
do $$
declare f text;
begin
  for f in
    select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'fb\_%'
  loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;
