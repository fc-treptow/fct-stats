"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Drop-down that sets one URL search parameter (like SeasonSelect, for any list). */
export default function ParamSelect({
  label,
  param,
  value,
  options,
  anchor,
}: {
  label: string;
  param: string;
  value: string;
  options: { key: string; label: string }[];
  /** keeps the page position at this element id */
  anchor?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <label className="season-select">
      {label}{" "}
      <select
        value={value}
        onChange={(e) => {
          const p = new URLSearchParams(params.toString());
          p.set(param, e.target.value);
          router.push(`${pathname}?${p.toString()}${anchor ? `#${anchor}` : ""}`, { scroll: !anchor });
        }}
      >
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
