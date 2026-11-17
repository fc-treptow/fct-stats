"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";

const REPO = "fc-treptow/fct-stats";

export async function startImport(_: unknown, formData: FormData): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!isAdmin(data.user?.email)) return { ok: false, message: "Nur für Admins." };

  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) return { ok: false, message: "GITHUB_DISPATCH_TOKEN ist in Vercel nicht gesetzt." };

  const mode = formData.get("mode") === "full" ? "full" : "current";
  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/import.yml/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: "main", inputs: { mode } }),
  });
  revalidatePath("/admin");
  if (res.status === 204) {
    return { ok: true, message: mode === "full" ? "Komplettimport gestartet (ca. 40 Min.)." : "Import gestartet (ca. 3–4 Min.)." };
  }
  return { ok: false, message: `GitHub hat den Start abgelehnt (${res.status}).` };
}
