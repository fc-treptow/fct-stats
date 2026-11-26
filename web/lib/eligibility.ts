// Eligibility of higher-team players for a lower team (BFV SpO § 6 Nr. 4 c/d).
// The rule itself lives in db/schema.sql (functions eligibility / eligibility_counting_matches).

export const RULE = {
  higher: "1",
  lower: "3",
  /** players who are locked but may still be used per match */
  maxLocked: 3,
  reference: "BFV-Spielordnung § 6 Nr. 4 c/d",
} as const;

export type CountingMatch = { match_id: string; kickoff_date: string; competition: string; home: string; away: string };
export type LockingMatch = { date: string; home: string; away: string; minutes: number | null };
export type EligibilityRow = {
  pass_nr: string;
  first_name: string;
  last_name: string;
  apps_higher: number;
  last_higher: string | null;
  apps_lower: number;
  locked: boolean;
  locking: LockingMatch[];
};

const CLUB = /FC Treptow/i;

/** The other team of one of our matches. */
export function opponent(m: { home: string | null; away: string | null }) {
  const home = m.home ?? "";
  const away = m.away ?? "";
  return (CLUB.test(home) ? away : home).replace(/\s+/g, " ").trim();
}

/** Today's date in Berlin as YYYY-MM-DD. */
export function berlinToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(now);
}

function addDays(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekday(iso: string) {
  return new Date(iso + "T00:00:00Z").getUTCDay(); // 0 = Sunday
}

/** The coming Sunday (today if today is Sunday). */
export function nextSunday(today = berlinToday()) {
  return addDays(today, (7 - weekday(today)) % 7);
}

/** The last Sunday before today: its matches should be in the data after the Sunday-night import. */
export function lastSunday(today = berlinToday()) {
  return addDays(today, -(weekday(today) || 7));
}

export function isIsoDate(s?: string): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
}
