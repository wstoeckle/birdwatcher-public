import type { CameraSummary } from '../lib';

export function CameraFilter({
  cameras,
  selected,
  onSelect,
}: {
  cameras: CameraSummary[];
  selected: string | null;
  onSelect: (device: string | null) => void;
}) {
  if (cameras.length <= 1) return null;
  const total = cameras.reduce((sum, camera) => sum + camera.count, 0);

  return (
    <section className="camera-filter" aria-label="Filter by camera">
      <button
        className={`camera-filter-btn${selected === null ? ' is-selected' : ''}`}
        type="button"
        onClick={() => onSelect(null)}
        aria-pressed={selected === null}
      >
        All cameras <span>{total}</span>
      </button>
      {cameras.map((camera) => (
        <button
          className={`camera-filter-btn${selected === camera.device ? ' is-selected' : ''}`}
          type="button"
          key={camera.device}
          onClick={() => onSelect(camera.device)}
          aria-pressed={selected === camera.device}
        >
          {camera.label} <span>{camera.count}</span>
        </button>
      ))}
    </section>
  );
}
