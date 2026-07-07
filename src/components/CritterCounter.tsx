import type { CritterCount } from '../types';
import { pluralize } from '../lib';

// A small emoji per known visitor; everything else gets paws.
const EMOJI: Record<string, string> = {
  squirrel: '🐿️',
  chipmunk: '🐿️',
  rabbit: '🐰',
  bunny: '🐰',
  deer: '🦌',
  raccoon: '🦝',
  fox: '🦊',
  cat: '🐈',
  dog: '🐕',
  coyote: '🐺',
  wolf: '🐺',
  human: '🧍',
  person: '🧍',
  bear: '🐻',
  skunk: '🦨',
  turkey: '🦃',
  groundhog: '🦫',
  mouse: '🐭',
  snake: '🐍',
  possum: '🐀',
  opossum: '🐀',
};

function emojiFor(species: string): string {
  const key = species.toLowerCase();
  return (
    Object.entries(EMOJI).find(([name]) => key.includes(name))?.[1] ??
    '🐾'
  );
}

function displayName(species: string, count: number): string {
  const lower = species.toLowerCase();
  const words = species.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return pluralize(lower, count);
  if (count === 1) return species;
  const last = words[words.length - 1] ?? '';
  return [...words.slice(0, -1), pluralize(last.toLowerCase(), count)].join(' ');
}

// The running tally of non-bird visitors — the feeder's "most wanted" list.
export function CritterCounter({ critters }: { critters: CritterCount[] }) {
  return (
    <section className="critters" aria-label="Critter count">
      <h2 className="critters-title">🐾 Critter patrol</h2>
      <p className="critters-sub">Photo-backed counts from the gallery below.</p>
      {critters.length === 0 ? (
        <p className="critters-empty">No critters yet — the squirrels are still plotting. 🐿️</p>
      ) : (
        <div className="critters-grid">
        {critters.map((c) => (
          <div className="critter-card" key={c.species}>
            <span className="critter-emoji" aria-hidden="true">
              {emojiFor(c.species)}
            </span>
            <span className="critter-count">{c.count.toLocaleString()}</span>
            <span className="critter-name">{displayName(c.species, c.count)}</span>
          </div>
        ))}
        </div>
      )}
    </section>
  );
}
