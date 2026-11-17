"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Pill buttons that set one URL search parameter. */
export default function FilterTabs({
  param,
  value,
  options,
}: {
  param: string;
  value: string;
  options: { key: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <div className="tabs" role="group">
      {options.map((o) => (
        <a
          key={o.key}
          href="#"
          className={o.key === value ? "active" : ""}
          onClick={(e) => {
            e.preventDefault();
            const p = new URLSearchParams(params.toString());
            p.set(param, o.key);
            router.push(`${pathname}?${p.toString()}`);
          }}
        >
          {o.label}
        </a>
      ))}
    </div>
  );
}
