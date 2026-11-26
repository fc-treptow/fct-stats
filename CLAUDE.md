# fct-stats – working notes for Claude

Player stats for FC Treptow's men's teams, imported from DFBnet. Users: coaches and the
sports director. UI text is German; code, comments and commits are English.

## Layout

- `importer/` – Python. `dfbnet.py` (login via Playwright, then the stateful
  SpielberichtOnline "Statistiken" webflow with requests), `parsers.py` (CSV exports),
  `store.py` (load into Postgres), `__main__.py` (CLI: fetch / load / run / reprocess / migrate).
- `db/schema.sql` – the whole schema: tables, derived tables, RLS, views. Idempotent.
- `web/` – Next.js 16 app on Vercel (root dir `web`), Supabase auth with Google.
  Uses `proxy.ts` (Next 16 name for middleware). Pages: `team/[group]`, `scorers`,
  `players`, `players/[pass]`, `cross-team`, `admin`.
- `.github/workflows/import.yml` – weekly import (Tue 01:17 UTC) + manual
  (`current`, `full`, `reprocess`). `schema.yml` – applies the schema on every push to main.

## Rules

- **The repo is public.** Never commit credentials, exports or player data (names, pass
  numbers) – not in code, tests, logs or commit messages. Test fixtures use made-up names.
  Log only counts and competition names.
- Work on a branch; the user merges. Merging to main deploys the app (Vercel) and applies
  `db/schema.sql` (schema workflow) at the same time – keep app and views compatible.
- Schema changes go into `db/schema.sql`, never only into the live database. Views
  are dropped and recreated in one place: add new views to the `drop view if exists` list.
- The Supabase connector is for reading. No writes or DDL against production unless the
  user asks; prefer `reprocess` on a branch to test loader or schema changes.

## Testing

- `python -m pytest -q` (parsers, flow page parsing).
- Loader/schema: local Postgres (`/usr/lib/postgresql/*/bin`, run as user `postgres`),
  `DATABASE_URL=... python -m importer load --out <folder>` with a synthetic manifest.
- Web: `cd web && npm install && NEXT_PUBLIC_SUPABASE_URL=https://x.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=x npx next build`.
- Real data: run the workflow on the branch (`mode=reprocess` needs no DFBnet login,
  ~2 min; `current` ~3 min; `full` ~40 min) and query via the Supabase connector.
  Vercel previews sit behind Vercel login; the cloud workspace cannot reach dfbnet.org,
  supabase.co or vercel.app directly (GitHub API works).

## Data pitfalls (all handled – keep it that way)

- Exports are declared UTF-8 but are Windows-1252 (`decode()`).
- Changing the report type in the DFBnet form resets team/fixture list: set the type first.
- The appearances export (report 7) is per team-season, repeated for every competition,
  and includes a player's matches for **other clubs** → keep only `CLUB_PATTERN` rows.
- The red-card export contains **all our teams'** red cards → keep rows of the entry's team.
- League scorer/yellow exports are league-wide; friendlies keep only our rows.
- Old-boys matches (Ü32/Ü40/Altliga) are recorded under the 1st team's name →
  `match_team_group()` gives them `'ue'`; they are not 1st-team matches.
- Team names change across seasons → always group by `team_group()` ('1','2','3','7er').
- Pass numbers change → same first+last name = same person (`players.person_id`).
- Some fixture lists (friendlies) are shared by two of our teams; `competitions` is keyed by
  fixture list, so friendly red cards can miss one team (known, minor).
- Supabase's statement timeout is 8 s for app users: heavy work (person ids, per-person
  matches, name index) is precomputed by `rebuild_derived()` at the end of each load.
  Keep views simple, filter on indexed columns, RLS policies use `(select is_club_member())`.
- Yellow bans: DFBnet bans after every 5th yellow per competition. Red-card ban lengths are
  not in the exports (DFBnet "Offene Sperren").

## Not in the data

Upcoming fixtures, scores/tables, assists, ban lengths, Sperrvermerke/registrations.
