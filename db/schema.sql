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

-- ------------------------------------------------------------------ derived tables
-- Rebuilt by rebuild_derived() at the end of every import (keeps the app's views fast).

alter table players add column if not exists person_id text;   -- same name = same person (see rebuild_derived)
create index if not exists players_person_idx on players(person_id);

create table if not exists person_matches (     -- one row per person and match (pass numbers merged)
    person_id     text not null,
    match_id      text not null,
    in_squad      boolean not null,
    played        boolean not null,
    minute_on     int,
    minute_off    int,
    minutes_real  int,
    primary key (person_id, match_id)
);
create index if not exists person_matches_match_idx on person_matches(match_id);

create table if not exists name_index (         -- names in card/goal exports -> person
    season      text not null,
    team        text not null,
    last_name   text not null,
    first_name  text not null,
    pass_nr     text not null
);
create index if not exists name_index_idx on name_index(season, team, last_name, first_name);

create or replace function rebuild_derived() returns void
language plpgsql as $$
begin
    -- A person = same first + last name; the most recently used pass number is the id.
    with last_seen as (
        select a.pass_nr, max(m.kickoff_date) as last_seen
        from appearances a join matches m using (match_id) group by a.pass_nr
    ), ranked as (
        select p.pass_nr,
               first_value(p.pass_nr) over (
                   partition by lower(btrim(p.first_name)), lower(btrim(p.last_name))
                   order by l.last_seen desc nulls last, p.pass_nr desc) as pid
        from players p left join last_seen l using (pass_nr)
    )
    update players p set person_id = r.pid
    from ranked r where r.pass_nr = p.pass_nr and p.person_id is distinct from r.pid;

    truncate person_matches;
    insert into person_matches
    select p.person_id, a.match_id, bool_or(a.in_squad), bool_or(a.played),
           min(a.minute_on), max(a.minute_off), max(a.minutes_real)
    from appearances a join players p using (pass_nr)
    group by p.person_id, a.match_id;

    truncate name_index;
    insert into name_index
    select distinct m.season, m.club_team, lower(btrim(p.last_name)), lower(btrim(p.first_name)), p.person_id
    from appearances a join matches m using (match_id) join players p using (pass_nr)
    union
    select c.season, al.team, lower(al.last_name), lower(al.first_name), coalesce(p.person_id, al.pass_nr)
    from player_aliases al
    join competitions c on c.team_name = al.team
    left join players p on p.pass_nr = al.pass_nr;
end
$$;

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

-- Team key of a match: old-boys matches (Ü32/Ü40/Altliga) are recorded under the 1st team's
-- name in DFBnet and get their own key.
create or replace function match_team_group(club_team text, competition text) returns text
language sql immutable as $$
    select case when competition ~* '(Ü ?[0-9]{2}|altliga)' then 'ue' else team_group(club_team) end
$$;

-- league / cup / friendly, from the DFBnet competition label of a match
create or replace function match_category(competition text) returns text
language sql immutable as $$
    select case
        when competition ~* 'pokal' then 'cup'
        when competition ~* '(FS/|-FS|freundschaft|turnier|halle)' then 'friendly'
        else 'league'
    end
$$;

-- same for a competition type of the DFBnet catalog (1 Meisterschaft, 308 Pokal, others friendly)
create or replace function competition_category(competition_type text) returns text
language sql immutable as $$
    select case competition_type when '1' then 'league' when '308' then 'cup' else 'friendly' end
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
                             'red_cards','goal_tallies','import_runs','player_aliases',
                             'person_matches','name_index'] loop
        execute format('alter table %I enable row level security', t);
        execute format('drop policy if exists club_read on %I', t);
        execute format('create policy club_read on %I for select using ((select public.is_club_member()))', t);
    end loop;
    alter table raw_exports enable row level security;  -- no policy: not readable through the API
end
$do$;

-- ------------------------------------------------------------------ views
-- security_invoker: views respect the RLS of the querying user.

drop view if exists v_player_totals, v_cross_team, v_player_identity, v_player_season_cat, v_team_matches, v_goals_cat, v_scorers, v_card_watch, v_red_cards, v_squad,
    v_yellow_status, v_player_season, v_name_to_player, v_seasons cascade;

create view v_seasons with (security_invoker = true) as
select season, count(distinct match_id) as matches
from matches group by season order by season desc;

-- Person ids are computed during the import (rebuild_derived): same name = same person.
create view v_player_identity with (security_invoker = true) as
select pass_nr, coalesce(person_id, pass_nr) as person_id from players;

create view v_name_to_player with (security_invoker = true) as
select season, team, last_name, first_name, pass_nr from name_index;

-- Per person, season, team and category (league / cup / friendly).
create view v_player_season_cat with (security_invoker = true) as
select
    m.season,
    m.club_team,
    match_team_group(m.club_team, m.competition)                             as team_group,
    match_category(m.competition)                                            as category,
    a.person_id                                                              as pass_nr,
    p.last_name,
    p.first_name,
    count(*) filter (where a.in_squad)                                       as squad,
    count(*) filter (where a.played)                                         as appearances,
    count(*) filter (where a.played and a.minute_on <= 1)                    as starts,
    count(*) filter (where a.played and a.minute_on > 1)                     as subbed_on,
    count(*) filter (where a.played and a.minute_off < coalesce(m.match_length, 90)) as subbed_off,
    coalesce(sum(a.minutes_real) filter (where a.played), 0)                 as minutes
from person_matches a
join matches m using (match_id)
join players p on p.pass_nr = a.person_id
group by 1, 2, 3, 4, a.person_id, p.last_name, p.first_name;

-- All matches of a team per season and category (base for "% of possible minutes").
create view v_team_matches with (security_invoker = true) as
select season, club_team, match_team_group(club_team, competition) as team_group,
       match_category(competition) as category,
       count(*) as matches,
       sum(coalesce(match_length, 90)) as possible_minutes
from matches
group by 1, 2, 3, 4;

-- Per person, season and team, all competitions. minutes_pct: league + cup minutes
-- against all league + cup minutes of the team.
create view v_player_season with (security_invoker = true) as
select
    c.season, c.club_team, c.team_group, c.pass_nr, c.last_name, c.first_name,
    sum(c.squad)        as squad,
    sum(c.appearances)  as appearances,
    sum(c.starts)       as starts,
    sum(c.subbed_on)    as subbed_on,
    sum(c.subbed_off)   as subbed_off,
    sum(c.minutes)      as minutes,
    sum(c.minutes) filter (where c.category in ('league', 'cup')) as minutes_comp,
    (select sum(t.possible_minutes) from v_team_matches t
      where t.season = c.season and t.club_team = c.club_team and t.team_group = c.team_group
        and t.category in ('league', 'cup')) as possible_minutes
from v_player_season_cat c
group by c.season, c.club_team, c.team_group, c.pass_nr, c.last_name, c.first_name;

-- Goals per person, season, team and category (scorer exports).
create view v_goals_cat with (security_invoker = true) as
select g.season, g.team, team_group(g.team) as team_group, n.pass_nr,
       competition_category(c.competition_type) as category, sum(g.goals) as goals
from goal_tallies g
join competitions c using (fixture_list_id)
join v_name_to_player n
  on n.season = g.season and n.team = g.team
 and n.last_name = lower(g.last_name) and n.first_name = lower(g.first_name)
group by 1, 2, 3, 4, 5;

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
select r.season, r.fixture_list_id, r.competition, c.competition_type,
       competition_category(c.competition_type) as category, r.matchday, r.team,
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
       case when ps.possible_minutes > 0 then round(100.0 * coalesce(ps.minutes_comp, 0) / ps.possible_minutes) end as minutes_pct,
       coalesce(g.goals_league, 0) as goals_league,
       coalesce(g.goals_all, 0)    as goals_all,
       coalesce(y.yellow, 0)       as yellow,
       coalesce(y.yellow_league, 0) as yellow_league,
       coalesce(y.ban_risk, false) as ban_risk,
       coalesce(r.yellow_red, 0)   as yellow_red,
       coalesce(r.red, 0)          as red
from v_player_season ps
left join goals  g on g.season = ps.season and g.team = ps.club_team and g.pass_nr = ps.pass_nr and ps.team_group <> 'ue'
left join yellow y on y.season = ps.season and y.team = ps.club_team and y.pass_nr = ps.pass_nr and ps.team_group <> 'ue'
left join red    r on r.season = ps.season and r.team = ps.club_team and r.pass_nr = ps.pass_nr and ps.team_group <> 'ue';

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
where team_group <> 'ue'
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
       (select string_agg(pl.pass_nr, ', ' order by pl.pass_nr) from players pl
         where pl.person_id = v_squad.pass_nr)  as pass_numbers
from v_squad
group by pass_nr, last_name, first_name;

-- ------------------------------------------------------------------ eligibility (Festspielen)
-- BFV SpO § 6 Nr. 4 c/d: a player is not eligible for an official match of a lower team if,
-- in the same season (Spieljahr, from 1 July), he came on in at least one of the last two
-- official matches (league/cup) that a higher team actually played before that match.
-- Up to three such players may still be used. Bench only does not count.
-- Functions run with the caller's rights, so the RLS of the tables applies.

-- '26/27' for any date from 1 July 2026 to 30 June 2027
create or replace function season_of(d date) returns text
language sql immutable as $$
    select lpad((y % 100)::text, 2, '0') || '/' || lpad(((y + 1) % 100)::text, 2, '0')
    from (select extract(year from d)::int - case when extract(month from d) < 7 then 1 else 0 end as y) s
$$;

drop function if exists eligibility(text, text, date);
drop function if exists eligibility_counting_matches(text, date);

-- The higher team's matches that count for a lower-team match on p_date (at most two).
create function eligibility_counting_matches(p_higher text, p_date date)
returns table (match_id text, kickoff_date date, competition text, home text, away text)
language sql stable as $$
    select m.match_id, m.kickoff_date, m.competition, m.home, m.away
    from matches m
    where m.season = season_of(p_date)
      and m.kickoff_date < p_date
      and match_team_group(m.club_team, m.competition) = p_higher
      and match_category(m.competition) in ('league', 'cup')
    order by m.kickoff_date desc, m.kickoff_time desc nulls last
    limit 2
$$;

-- Everyone who played for the higher team this season (before p_date), with:
-- apps_higher / last_higher: matches for the higher team (all competitions),
-- apps_lower: official matches for the lower team, locked + locking: the counting matches he played in.
create function eligibility(p_higher text, p_lower text, p_date date)
returns table (pass_nr text, first_name text, last_name text, apps_higher int, last_higher date,
               apps_lower int, locked boolean, locking jsonb)
language sql stable as $$
    with played as (
        select a.person_id, a.match_id, a.minutes_real, m.kickoff_date, m.home, m.away,
               match_team_group(m.club_team, m.competition) as tg,
               match_category(m.competition) as cat,
               a.match_id in (select c.match_id from eligibility_counting_matches(p_higher, p_date) c) as counting
        from person_matches a
        join matches m using (match_id)
        where a.played and m.season = season_of(p_date) and m.kickoff_date < p_date
    )
    select pl.pass_nr, pl.first_name, pl.last_name,
           (count(*) filter (where s.tg = p_higher))::int,
           max(s.kickoff_date) filter (where s.tg = p_higher),
           (count(*) filter (where s.tg = p_lower and s.cat <> 'friendly'))::int,
           bool_or(s.counting),
           coalesce(jsonb_agg(jsonb_build_object('date', s.kickoff_date, 'home', s.home, 'away', s.away,
                                                 'minutes', s.minutes_real)
                              order by s.kickoff_date desc) filter (where s.counting), '[]'::jsonb)
    from played s
    join players pl on pl.pass_nr = s.person_id
    where s.person_id in (select x.person_id from played x where x.tg = p_higher)
    group by pl.pass_nr, pl.first_name, pl.last_name
$$;

grant select on all tables in schema public to authenticated;
