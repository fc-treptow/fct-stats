"use client";

import { useActionState } from "react";
import { startImport } from "./actions";

export default function ImportButton() {
  const [state, action, pending] = useActionState(startImport, null);
  return (
    <form action={action} style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
      <select name="mode" defaultValue="current" className="btn">
        <option value="current">Aktuelle Saison</option>
        <option value="full">Alle Saisons</option>
      </select>
      <button className="btn btn-primary" disabled={pending}>
        {pending ? "Starte…" : "Jetzt aktualisieren"}
      </button>
      {state && <span className={state.ok ? "" : "alert"}>{state.message}</span>}
    </form>
  );
}
