import type { SpeciesSummary } from '../lib';

// A species checklist: one row per species with its sighting count, most
// sightings first. Used on both the bird gallery and the critter page.
//
// When `onSelect` is supplied the table doubles as the gallery filter: each row
// is clickable, a leading "All birds" row clears the filter, and the active
// species is highlighted. Without it the table is a plain, static checklist.
export function SpeciesTable({
  title,
  rows,
  selected,
  onSelect,
  allLabel = 'All',
}: {
  title: string;
  rows: SpeciesSummary[];
  selected?: string | null;
  onSelect?: (species: string | null) => void;
  /** Label for the leading "clear filter" row when interactive, e.g. "All birds". */
  allLabel?: string;
}) {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => b.count - a.count || a.species.localeCompare(b.species));
  const interactive = typeof onSelect === 'function';
  const total = sorted.reduce((sum, r) => sum + r.count, 0);

  return (
    <section className="species-table-wrap" aria-label={title}>
      <h2 className="species-table-title">{title}</h2>
      <table className={`species-table ${interactive ? 'is-filter' : ''}`}>
        <thead>
          <tr>
            <th scope="col">Species</th>
            <th scope="col" className="species-table-num">
              Sightings
            </th>
          </tr>
        </thead>
        <tbody>
          {interactive && (
            <FilterRow
              label={allLabel}
              count={total}
              isSelected={selected == null}
              onSelect={() => onSelect!(null)}
            />
          )}
          {sorted.map((r) =>
            interactive ? (
              <FilterRow
                key={r.species}
                label={r.species}
                imageUrl={r.imageUrl}
                count={r.count}
                isSelected={selected === r.species}
                onSelect={() => onSelect!(selected === r.species ? null : r.species)}
              />
            ) : (
              <tr key={r.species}>
                <td>{r.species}</td>
                <td className="species-table-num">{r.count.toLocaleString()}</td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </section>
  );
}

// One clickable row in the filter-mode table. Keyboard-operable (Enter/Space).
function FilterRow({
  label,
  imageUrl,
  count,
  isSelected,
  onSelect,
}: {
  label: string;
  imageUrl?: string;
  count: number;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <tr
      className={`species-row ${isSelected ? 'is-selected' : ''}`}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <td>
        <span className="species-row-label">
          {imageUrl ? (
            <img className="species-row-thumb" src={imageUrl} alt="" aria-hidden="true" />
          ) : (
            <span className="species-row-thumb species-row-thumb-all" aria-hidden="true" />
          )}
          {label}
        </span>
      </td>
      <td className="species-table-num">{count.toLocaleString()}</td>
    </tr>
  );
}
