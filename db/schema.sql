-- fct-stats schema (PostgreSQL / Supabase). Idempotent: safe to run on every import.

create table if not exists competitions (
    fixture_list_id   text primary key,          -- DFBnet "Staffel" id
    season            text not null,             -- e.g. '26/27'
    competition_type  text not null,             -- 1 Meisterschaft, 308 Pokal, 70 Freundschaftsspiel, ...
    name              text not null,
    team_id           text not null,             -- DFBnet team id (changes per season)
    team_name         text not null,
    updated_at        timestamptz not null default now()
);

create table if not exists players (
    pass_nr      text primary key,
    last_name    text not null,
    first_name   text not null,
    nationality  text,
    fifa_nat     text,
    updated_at   timestamptz not null default now()
);

create table if not exists matches (
    match_id      text primary key,              -- SPIELKENNUNG
    season        text not null,
    kickoff_date  date,
    kickoff_time  time,
    competition   text,                          -- STAFFEL-POKALRUNDE, e.g. 'Kreisliga B Herren ...' / 'Berlin-Pokal Runde 1'
    matchday      int,
    club_team     text not null,                 -- our team in this match
    home          text,
    away          text,
    match_length  int                            -- end minute of the 2nd half (usually 90)
);
create index if not exists matches_season_idx on matches(season, club_team);

create table if not exists appearances (
    pass_nr       text not null references players(pass_nr),
    match_id      text not null references matches(match_id),
    shirt_no      int,
    in_squad      boolean not null,
    played        boolean not null,
    minute_on     int,
    minute_off    int,
    minutes_real  int,
    minutes_norm  int,
    active        boolean,
    status        text,
    primary key (pass_nr, match_id)
);

-- One row per player and competition: dates of all yellow cards (DFBnet "Gelbe Karten bisher").
create table if not exists yellow_tallies (
    season           text not null,
    fixture_list_id  text not null,
    competition      text not null,
    team             text not null,
    last_name        text not null,
    first_name       text not null,
    shirt_no         int,
    card_dates       date[] not null,
    ban_marks        text[] not null,            -- raw SPERRE columns (after every 5th card)
    primary key (fixture_list_id, team, last_name, first_name)
);

create table if not exists red_cards (
    id               bigserial primary key,
    season           text not null,
    fixture_list_id  text not null,
    competition      text not null,
    matchday         int,
    team             text not null,
    kind             text not null check (kind in ('GR', 'R')),
    last_name        text not null,
    first_name       text not null,
    shirt_no         int
);
create index if not exists red_cards_fl_idx on red_cards(fixture_list_id);

-- Goal scorers of the whole league (all clubs), per competition.
create table if not exists goal_tallies (
    season           text not null,
    fixture_list_id  text not null,
    competition      text not null,
    team             text not null,
    last_name        text not null,
    first_name       text not null,
    shirt_no         int,
    goals            int not null,
    primary key (fixture_list_id, team, last_name, first_name)
);

create table if not exists raw_exports (
    fixture_list_id  text not null,
    report           text not null,
    fetched_at       timestamptz not null default now(),
    filename         text,
    content          text not null,
    primary key (fixture_list_id, report)
);

create table if not exists import_runs (
    id           bigserial primary key,
    started_at   timestamptz not null default now(),
    finished_at  timestamptz,
    mode         text not null,
    status       text not null default 'running',
    details      jsonb
);

-- Manual corrections: map a card/goal name to a player when names differ.
create table if not exists player_aliases (
    team        text not null,
    last_name   text not null,
    first_name  text not null,
    pass_nr     text not null references players(pass_nr),
    primary key (team, last_name, first_name)
);

-- ------------------------------------------------------------------ helpers

-- Stable team key across seasons: DFBnet team names change over the years
-- ("FC Treptow II", "FC Treptow II River Plate 2", "FC Treptow / River Plate III", "FC Treptow 7er").
create or replace function team_group(name text) returns text
language sql immutable as $$
    select case
        when name ~* '7er' then '7er'
        when name ~* '\mIII\M' then '3'
        when name ~* '\mII\M' then '2'
        else '1'
    end
$$;

-- ------------------------------------------------------------------ security (Supabase)
-- Only @fc-treptow.de accounts may sign up, and only they can read the data.
-- The importer connects as the database owner and is not affected by RLS.

do $do$
begin
    if exists (select 1 from pg_namespace where nspname = 'auth') then
        execute $f$
            create or replace function public.is_club_member() returns boolean
            language sql stable as $$
                select coalesce(lower(auth.jwt() ->> 'email') like '%@fc-treptow.de', false)
            $$ $f$;
        execute $f$
            create or replace function public.enforce_club_domain() returns trigger
            language plpgsql security definer set search_path = public as $$
            begin
                if new.email is null or lower(new.email) not like '%@fc-treptow.de' then
                    raise exception 'Only @fc-treptow.de accounts are allowed';
                end if;
                return new;
            end $$ $f$;
        begin
            execute 'drop trigger if exists enforce_club_domain on auth.users';
            execute 'create trigger enforce_club_domain before insert or update of email on auth.users
                     for each row execute function public.enforce_club_domain()';
        exception when insufficient_privilege then
            raise notice 'Could not create the domain trigger on auth.users (no privilege) - RLS still applies';
        end;
    else
        -- plain PostgreSQL (local development): nobody is a "club member" via JWT
        create or replace function public.is_club_member() returns boolean
        language sql stable as $f$ select false $f$;
    end if;
end
$do$;

do $do$
declare t text;
begin
    foreach t in array array['competitions','players','matches','appearances','yellow_tallies',
                             'red_cards','goal_tallies','import_runs','player_aliases'] loop
        execute format('alter table %I enable row level security', t);
        execute format('drop policy if exists club_read on %I', t);
        execute format('create policy club_read on %I for select using (public.is_club_member())', t);
    end loop;
    alter table raw_exports enable row level security;  -- no policy: not readable through the API
end
$do$;

-- ------------------------------------------------------------------ views
-- security_invoker: views respect the RLS of the querying user.

drop view if exists v_player_totals, v_cross_team, v_player_identity, v_scorers, v_card_watch, v_red_cards, v_squad,
    v_yellow_status, v_player_season, v_name_to_player, v_seasons cascade;

create view v_seasons with (security_invoker = true) as
select season, count(distinct match_id) as matches
from matches group by season order by season desc;

-- One person = same first and last name. DFBnet pass numbers can change over the years;
-- the most recently used pass number becomes the person's id ("pass_nr" in all views below).
create view v_player_identity with (security_invoker = true) as
with last_seen as (
    select a.pass_nr, max(m.kickoff_date) as last_seen
    from appearances a join matches m using (match_id)
    group by a.pass_nr
)
select p.pass_nr,
       first_value(p.pass_nr) over (
           partition by lower(btrim(p.first_name)), lower(btrim(p.last_name))
           order by l.last_seen desc nulls last, p.pass_nr desc) as person_id
from players p
left join last_seen l using (pass_nr);

-- Resolve names (cards / goals) to persons via appearances in the same season and team.
create view v_name_to_player with (security_invoker = true) as
select distinct m.season, m.club_team as team, lower(btrim(p.last_name)) as last_name,
       lower(btrim(p.first_name)) as first_name, i.person_id as pass_nr
from appearances a
join matches m using (match_id)
join players p using (pass_nr)
join v_player_identity i using (pass_nr)
union
select c.season, al.team, lower(al.last_name), lower(al.first_name), coalesce(i.person_id, al.pass_nr)
from player_aliases al
join competitions c on c.team_name = al.team
left join v_player_identity i on i.pass_nr = al.pass_nr;

create view v_player_season with (security_invoker = true) as
with per_match as (   -- one row per person and match, even if two pass numbers were used
    select i.person_id, a.match_id,
           bool_or(a.in_squad)  as in_squad,
           bool_or(a.played)    as played,
           min(a.minute_on)     as minute_on,
           max(a.minute_off)    as minute_off,
           max(a.minutes_real)  as minutes_real
    from appearances a
    join v_player_identity i using (pass_nr)
    group by i.person_id, a.match_id
)
select
    m.season,
    m.club_team,
    team_group(m.club_team)                                                  as team_group,
    a.person_id                                                              as pass_nr,
    p.last_name,
    p.first_name,
    count(*) filter (where a.in_squad)                                       as squad,
    count(*) filter (where a.played)                                         as appearances,
    count(*) filter (where a.played and a.minute_on <= 1)                    as starts,
    count(*) filter (where a.played and a.minute_on > 1)                     as subbed_on,
    count(*) filter (where a.played and a.minute_off < coalesce(m.match_length, 90)) as subbed_off,
    coalesce(sum(a.minutes_real) filter (where a.played), 0)                 as minutes,
    count(distinct m.match_id)                                               as team_matches,
    coalesce(sum(coalesce(m.match_length, 90)), 0)                           as possible_minutes
from per_match a
join matches m using (match_id)
join players p on p.pass_nr = a.person_id
group by m.season, m.club_team, a.person_id, p.last_name, p.first_name;

-- Yellow card status per competition. DFBnet bans after every 5th yellow card.
create view v_yellow_status with (security_invoker = true) as
select
    y.season, y.fixture_list_id, y.competition, c.competition_type, y.team, team_group(y.team) as team_group,
    y.last_name, y.first_name, n.pass_nr,
    cardinality(y.card_dates)                                   as yellow_cards,
    cardinality(y.card_dates) % 5                               as in_cycle,
    (cardinality(y.card_dates) % 5 = 4)                         as one_more_is_ban,
    y.card_dates[cardinality(y.card_dates)]                     as last_card,
    y.ban_marks
from yellow_tallies y
left join competitions c using (fixture_list_id)
left join v_name_to_player n
  on n.season = y.season and n.team = y.team
 and n.last_name = lower(y.last_name) and n.first_name = lower(y.first_name);

create view v_red_cards with (security_invoker = true) as
select r.season, r.fixture_list_id, r.competition, c.competition_type, r.matchday, r.team,
       team_group(r.team) as team_group, r.kind, r.last_name, r.first_name, n.pass_nr
from red_cards r
left join competitions c using (fixture_list_id)
left join v_name_to_player n
  on n.season = r.season and n.team = r.team
 and n.last_name = lower(r.last_name) and n.first_name = lower(r.first_name);

-- Players of the season in a team with minutes, goals and cards.
create view v_squad with (security_invoker = true) as
with goals as (
    select g.season, g.team, n.pass_nr,
           sum(g.goals) filter (where c.competition_type = '1') as goals_league,
           sum(g.goals)                                         as goals_all
    from goal_tallies g
    join competitions c using (fixture_list_id)
    join v_name_to_player n
      on n.season = g.season and n.team = g.team
     and n.last_name = lower(g.last_name) and n.first_name = lower(g.first_name)
    group by g.season, g.team, n.pass_nr
), yellow as (
    select season, team, pass_nr,
           sum(yellow_cards) as yellow,
           max(yellow_cards) filter (where competition_type = '1') as yellow_league,
           bool_or(one_more_is_ban and competition_type = '1') as ban_risk
    from v_yellow_status where pass_nr is not null group by season, team, pass_nr
), red as (
    select season, team, pass_nr,
           count(*) filter (where kind = 'GR') as yellow_red,
           count(*) filter (where kind = 'R')  as red
    from v_red_cards where pass_nr is not null group by season, team, pass_nr
)
select ps.*,
       case when ps.possible_minutes > 0 then round(100.0 * ps.minutes / ps.possible_minutes) end as minutes_pct,
       coalesce(g.goals_league, 0) as goals_league,
       coalesce(g.goals_all, 0)    as goals_all,
       coalesce(y.yellow, 0)       as yellow,
       coalesce(y.yellow_league, 0) as yellow_league,
       coalesce(y.ban_risk, false) as ban_risk,
       coalesce(r.yellow_red, 0)   as yellow_red,
       coalesce(r.red, 0)          as red
from v_player_season ps
left join goals  g on g.season = ps.season and g.team = ps.club_team and g.pass_nr = ps.pass_nr
left join yellow y on y.season = ps.season and y.team = ps.club_team and y.pass_nr = ps.pass_nr
left join red    r on r.season = ps.season and r.team = ps.club_team and r.pass_nr = ps.pass_nr;

-- Scorer rankings per competition (league competitions contain all clubs).
create view v_scorers with (security_invoker = true) as
select g.season, g.fixture_list_id, g.competition, c.competition_type, g.team, team_group(g.team) as team_group,
       g.last_name, g.first_name, g.goals, n.pass_nr,
       (g.team ilike 'FC Treptow%') as is_ours,
       rank() over (partition by g.fixture_list_id order by g.goals desc) as league_rank
from goal_tallies g
left join competitions c using (fixture_list_id)
left join v_name_to_player n
  on n.season = g.season and n.team = g.team
 and n.last_name = lower(g.last_name) and n.first_name = lower(g.first_name);

-- Players used in more than one team in a season.
create view v_cross_team with (security_invoker = true) as
select season, pass_nr, last_name, first_name,
       sum(appearances) filter (where team_group = '1')   as apps_1,
       sum(appearances) filter (where team_group = '2')   as apps_2,
       sum(appearances) filter (where team_group = '3')   as apps_3,
       sum(appearances) filter (where team_group = '7er') as apps_7er,
       sum(appearances)                                   as apps_total,
       count(*) filter (where appearances > 0)            as teams_used
from v_player_season
group by season, pass_nr, last_name, first_name
having count(*) filter (where appearances > 0) > 1;

-- One row per player: career totals (player list / search).
create view v_player_totals with (security_invoker = true) as
select pass_nr, last_name, first_name,
       count(distinct season)                 as seasons,
       min(season)                            as first_season,
       max(season)                            as last_season,
       sum(appearances)                       as appearances,
       sum(minutes)                           as minutes,
       sum(goals_all)                         as goals,
       sum(yellow)                            as yellow,
       sum(red) + sum(yellow_red)             as red,
       string_agg(distinct team_group, ',' order by team_group) as team_groups,
       (select string_agg(i.pass_nr, ', ' order by i.pass_nr) from v_player_identity i
         where i.person_id = v_squad.pass_nr)  as pass_numbers
from v_squad
group by pass_nr, last_name, first_name;

grant select on all tables in schema public to authenticated;
