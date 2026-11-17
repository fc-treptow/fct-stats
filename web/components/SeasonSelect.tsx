"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export default function SeasonSelect({ seasons, season }: { seasons: string[]; season: string }) {
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
          router.push(`${pathname}?${p.toString()}`);
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
