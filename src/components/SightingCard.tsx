import type { Sighting } from '../types';
import { cameraLabel, formatWhen } from '../lib';

export function SightingCard({ sighting, onOpen }: { sighting: Sighting; onOpen: () => void }) {
  return (
    <button className="card" onClick={onOpen} aria-label={`See details for ${sighting.species}`}>
      <div className="card-photo">
        <img src={sighting.imageUrl} alt={sighting.species} loading="lazy" decoding="async" />
        {sighting.manual && <span className="card-badge">📸 Live snapshot</span>}
      </div>
      <div className="card-body">
        <h3 className="card-species">{sighting.species}</h3>
        {sighting.scientificName && <p className="card-sci">{sighting.scientificName}</p>}
        <p className="card-when">
          {formatWhen(sighting.capturedAt)}
          {sighting.device ? ` · ${cameraLabel(sighting.device)}` : ''}
        </p>
      </div>
    </button>
  );
}
