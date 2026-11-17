import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { TEAMS } from "@/lib/data";

export const metadata: Metadata = {
  title: "FC Treptow Statistik",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email;
  return (
    <html lang="de">
      <body>
        {email && (
          <header className="topbar">
            <Link href="/" className="brand">
              FC Treptow <span>Statistik</span>
            </Link>
            <nav>
              {TEAMS.slice(0, 3).map((t) => (
                <Link key={t.key} href={`/team/${t.key}`}>
                  {t.label}
                </Link>
              ))}
              <Link href="/scorers">Torschützen</Link>
              <Link href="/players">Spieler</Link>
              <Link href="/cross-team">Teamübergreifend</Link>
              {isAdmin(email) && <Link href="/admin">Import</Link>}
            </nav>
            <form action="/auth/signout" method="post" className="user">
              <span className="muted small">{email}</span>
              <button className="btn btn-small">Abmelden</button>
            </form>
          </header>
        )}
        <div className="page">{children}</div>
      </body>
    </html>
  );
}
