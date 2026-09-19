// Inline (not <img src="/logo.svg">) so its fills can read the --logo-face-*
// CSS variables live — an <img> renders an external SVG as an opaque bitmap
// that can't see the page's custom properties, so it could never follow the
// dark-mode swap the way every other themed element does.
export default function Logo({ className }) {
  return (
    <svg className={className} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Delyver">
      <polygon points="56,14 86,32 56,50 26,32" fill="var(--logo-face-top)" />
      <polygon points="26,32 56,50 56,82 26,64" fill="var(--logo-face-left)" />
      <polygon points="86,32 56,50 56,82 86,64" fill="var(--logo-face-right)" />
      <circle cx="82" cy="70" r="15" fill="var(--logo-badge)" stroke="var(--logo-badge-ink)" strokeWidth="3" />
      <path
        d="M75 70 L80 75 L90 63"
        fill="none"
        stroke="var(--logo-badge-ink)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
