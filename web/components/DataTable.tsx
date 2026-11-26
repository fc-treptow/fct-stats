"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export type Column = {
  key: string;
  label: string;
  /** player: link to the profile (needs pass_nr in the row); num: right aligned; pct: number + "%" */
  type?: "text" | "player" | "num" | "pct" | "badge";
  title?: string;
};

type Row = Record<string, any>;

export default function DataTable({
  columns,
  rows,
  defaultSort,
  search = false,
  rowClass,
  empty = "Keine Daten.",
  initialQuery = "",
}: {
  columns: Column[];
  rows: Row[];
  defaultSort?: { key: string; desc?: boolean };
  search?: boolean;
  /** key of a boolean field: rows where it is true get the "highlight" class */
  rowClass?: string;
  empty?: string;
  /** prefills the search box (e.g. from the home page's player search) */
  initialQuery?: string;
}) {
  const [sort, setSort] = useState(defaultSort ?? { key: columns[0].key, desc: false });
  const [q, setQ] = useState(initialQuery);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? rows.filter((r) => `${r.first_name ?? ""} ${r.last_name ?? ""} ${r.name ?? ""}`.toLowerCase().includes(needle))
      : rows;
    const val = (r: Row) => {
      const c = columns.find((c) => c.key === sort.key);
      if (c?.type === "player") return `${r.last_name ?? ""} ${r.first_name ?? ""}`.toLowerCase();
      return r[sort.key];
    };
    return [...filtered].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      const cmp = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "de");
      return sort.desc ? -cmp : cmp;
    });
  }, [rows, q, sort, columns]);

  return (
    <div className="table-wrap">
      {search && (
        <input className="search" placeholder="Spieler suchen…" value={q} onChange={(e) => setQ(e.target.value)} />
      )}
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                title={c.title}
                className={c.type === "num" || c.type === "pct" ? "num" : ""}
                onClick={() =>
                  setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : c.type === "num" || c.type === "pct" }))
                }
              >
                {c.label}
                {sort.key === c.key ? (sort.desc ? " ↓" : " ↑") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="muted">
                {empty}
              </td>
            </tr>
          )}
          {shown.map((r, i) => (
            <tr key={i} className={rowClass && r[rowClass] ? "highlight" : ""}>
              {columns.map((c) => (
                <td key={c.key} className={c.type === "num" || c.type === "pct" ? "num" : ""}>
                  {c.type === "player" ? (
                    r.pass_nr ? (
                      <Link href={`/players/${encodeURIComponent(r.pass_nr)}`}>
                        {r.last_name}, {r.first_name}
                      </Link>
                    ) : (
                      `${r.last_name}, ${r.first_name}`
                    )
                  ) : c.type === "pct" ? (
                    r[c.key] == null ? "" : `${r[c.key]} %`
                  ) : c.type === "badge" ? (
                    r[c.key] ? <span className="badge">{r[c.key]}</span> : ""
                  ) : (
                    r[c.key] ?? ""
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
