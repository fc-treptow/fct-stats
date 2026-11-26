import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "flag-icons/css/flag-icons.min.css";
import "./globals.css";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { TEAMS } from "@/lib/data";
import NavLinks from "@/components/NavLinks";

export const metadata: Metadata = {
  title: "FC Treptow Statistik",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#000000",
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
              <img src="/crest.png" alt="" width={38} height={40} />
              FC Treptow <span>Statistik</span>
            </Link>
            <NavLinks
              links={[
                ...TEAMS.slice(0, 3).map((t) => ({ href: `/team/${t.key}`, label: t.label })),
                { href: "/scorers", label: "Torschützen" },
                { href: "/players", label: "Spieler" },
                { href: "/cross-team", label: "Teamübergreifend" },
                { href: "/eligibility", label: "Einsatzcheck" },
                ...(isAdmin(email) ? [{ href: "/admin", label: "Import" }] : []),
              ]}
            />
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
