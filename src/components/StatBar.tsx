export interface Stat {
  value: number;
  /** Plural noun, e.g. "Birds" or "Species". Auto-singularized for a count of 1. */
  label: string;
}

// A compact summary row of big numbers — e.g. "127 Birds · 14 Species" — shown at
// the top of the bird gallery and the critter page.
export function StatBar({ stats }: { stats: Stat[] }) {
  return (
    <dl className="statbar">
      {stats.map((s) => (
        <div className="stat" key={s.label}>
          <dt className="stat-value">{s.value.toLocaleString()}</dt>
          <dd className="stat-label">{labelFor(s.value, s.label)}</dd>
        </div>
      ))}
    </dl>
  );
}

// "Species" reads the same singular or plural; otherwise drop a trailing "s" at 1.
function labelFor(value: number, label: string): string {
  if (value === 1 && label !== 'Species' && label.endsWith('s')) return label.slice(0, -1);
  return label;
}
