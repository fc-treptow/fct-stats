"use client";

import { useState } from "react";

type Player = { name: string; apps: number; reason?: string };

export default function CopyMessage({
  matchDate,
  counting,
  free,
  locked,
  maxLocked,
}: {
  matchDate: string;
  counting: string[];
  free: Player[];
  locked: Player[];
  maxLocked: number;
}) {
  const [lang, setLang] = useState<"de" | "en">("de");
  const [copied, setCopied] = useState(false);

  const text =
    lang === "de"
      ? [
          `Einsatzcheck 1. → 3. Herren für ${matchDate}`,
          `Zählen: die letzten zwei Pflichtspiele der 1. Herren: ${counting.join(", ") || "–"}.`,
          `Wer dort eingesetzt wurde (Spielzeit, Bank zählt nicht), ist festgespielt. Davon dürfen max. ${maxLocked} spielen.`,
          "",
          `✅ Frei (${free.length}): ${free.map((p) => p.name).join(", ") || "–"}`,
          "",
          `⛔ Festgespielt, max. ${maxLocked} (${locked.length}): ${locked.map((p) => p.name).join(", ") || "–"}`,
        ].join("\n")
      : [
          `Eligibility 1st → 3rd team for ${matchDate}`,
          `What counts: the 1st team's last two official matches: ${counting.join(", ") || "–"}.`,
          `Anyone who came on in one of them is blocked (bench doesn't count). You can use max. ${maxLocked} of them.`,
          "",
          `✅ Free (${free.length}): ${free.map((p) => p.name).join(", ") || "–"}`,
          "",
          `⛔ Blocked, max. ${maxLocked} (${locked.length}): ${locked.map((p) => p.name).join(", ") || "–"}`,
        ].join("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="card" style={{ display: "grid", gap: "0.6rem" }}>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <strong>Als Nachricht</strong>
        <select className="btn btn-small" value={lang} onChange={(e) => setLang(e.target.value as "de" | "en")}>
          <option value="de">Deutsch</option>
          <option value="en">English</option>
        </select>
        <button className="btn btn-primary btn-small" onClick={copy}>
          {copied ? "Kopiert ✓" : "Kopieren"}
        </button>
      </div>
      <pre className="small" style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit" }}>
        {text}
      </pre>
    </div>
  );
}
