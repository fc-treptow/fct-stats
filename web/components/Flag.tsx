import { countryCode } from "@/lib/countries";

/** Small country flag (self-hosted SVG via flag-icons) with the German country name as tooltip. */
export default function Flag({ nationality }: { nationality?: string | null }) {
  if (!nationality) return null;
  const code = countryCode(nationality);
  return (
    <span
      className={code ? `flag fi fi-${code}` : "flag flag-unknown"}
      title={nationality}
      role="img"
      aria-label={nationality}
    />
  );
}
