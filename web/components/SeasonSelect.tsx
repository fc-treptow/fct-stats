"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** `clear`: search parameters that no longer fit another season (dropped on change).
 *  `anchor`: keeps the page position, e.g. "spiele" for a section further down. */
export default function SeasonSelect({
  seasons,
  season,
  clear = [],
  anchor,
}: {
  seasons: string[];
  season: string;
  clear?: string[];
  anchor?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <label className="season-select">
      Saison{" "}
      <select
        value={season}
        onChange={(e) => {
          const p = new URLSearchParams(params.toString());
          p.set("season", e.target.value);
          for (const k of clear) p.delete(k);
          router.push(`${pathname}?${p.toString()}${anchor ? `#${anchor}` : ""}`, { scroll: !anchor });
        }}
      >
        {seasons.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </label>
  );
}
