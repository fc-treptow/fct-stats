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

-- ------------------------------------------------------------------ views

-- Resolve names (cards / goals) to pass numbers via appearances in the same season and team.
create or replace view v_name_to_player as
select distinct m.season, m.club_team as team, p.last_name, p.first_name, p.pass_nr
from appearances a
join matches m using (match_id)
join players p using (pass_nr)
union
select c.season, al.team, al.last_name, al.first_name, al.pass_nr
from player_aliases al
join competitions c on c.team_name = al.team;

create or replace view v_player_season as
select
    m.season,
    m.club_team,
    a.pass_nr,
    p.last_name,
    p.first_name,
    count(*) filter (where a.in_squad)                                       as squad,
    count(*) filter (where a.played)                                         as appearances,
    count(*) filter (where a.played and a.minute_on <= 1)                    as starts,
    count(*) filter (where a.played and a.minute_on > 1)                     as subbed_on,
    count(*) filter (where a.played and a.minute_off < coalesce(m.match_length, 90)) as subbed_off,
    coalesce(sum(a.minutes_real) filter (where a.played), 0)                 as minutes,
    coalesce(sum(a.minutes_norm) filter (where a.played), 0)                 as minutes_norm,
    count(distinct m.match_id)                                               as team_matches
from appearances a
join matches m using (match_id)
join players p using (pass_nr)
group by m.season, m.club_team, a.pass_nr, p.last_name, p.first_name;

-- Yellow card status per competition. DFBnet bans after every 5th yellow card.
create or replace view v_yellow_status as
select
    y.season, y.competition, y.team, y.last_name, y.first_name, n.pass_nr,
    cardinality(y.card_dates)                                   as yellow_cards,
    cardinality(y.card_dates) % 5                               as in_cycle,
    (cardinality(y.card_dates) % 5 = 4)                         as one_more_is_ban,
    y.card_dates[cardinality(y.card_dates)]                     as last_card,
    y.ban_marks
from yellow_tallies y
left join v_name_to_player n
  on n.season = y.season and n.team = y.team
 and lower(n.last_name) = lower(y.last_name) and lower(n.first_name) = lower(y.first_name);
