"use client";

import { createClient } from "@/lib/supabase/client";
import { CLUB_DOMAIN } from "@/lib/auth";

export default function LoginButton() {
  async function signIn() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { hd: CLUB_DOMAIN, prompt: "select_account" },
      },
    });
  }
  return (
    <button className="btn btn-primary" onClick={signIn}>
      Mit Google anmelden
    </button>
  );
}
