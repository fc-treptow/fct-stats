export const CLUB_DOMAIN = "fc-treptow.de";

export function isClubEmail(email?: string | null) {
  return !!email && email.toLowerCase().endsWith("@" + CLUB_DOMAIN);
}

export function isAdmin(email?: string | null) {
  if (!email) return false;
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.toLowerCase());
}
