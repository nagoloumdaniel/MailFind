/**
 * La marque, en SVG dans le document plutot qu'en <img> : les montants suivent
 * `currentColor`, donc le theme, et seul le rabat garde l'ambre.
 */
export function Logo({ size = 28, title }: { size?: number; title?: string }) {
  return (
    <svg
      viewBox="112 112 288 288"
      width={size}
      height={size}
      role={title === undefined ? 'presentation' : 'img'}
      aria-label={title}
      aria-hidden={title === undefined}
    >
      <g fill="none" strokeWidth="64" strokeLinecap="round" strokeLinejoin="round">
        <path d="M144 144 L256 272 L368 144" stroke="var(--accent)" />
        <path d="M144 368 V144" stroke="currentColor" />
        <path d="M368 368 V144" stroke="currentColor" />
      </g>
    </svg>
  );
}
