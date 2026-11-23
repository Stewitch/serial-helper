/** App mark: a pad outline with a serial waveform across it. */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden className="pointer-events-none">
      <rect x="3" y="3" width="16" height="16" rx="3" stroke="rgb(var(--accent))" strokeWidth="1.6" />
      <path
        d="M7 11h2.5l1.5-3 2 6 1.5-3H15"
        stroke="rgb(var(--ink))"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
