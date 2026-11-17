import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isClubEmail } from "@/lib/auth";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && isClubEmail(data.user?.email)) {
      return NextResponse.redirect(`${origin}/`);
    }
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=domain`);
  }
  const reason = searchParams.get("error_description") ? "domain" : "failed";
  return NextResponse.redirect(`${origin}/login?error=${reason}`);
}
