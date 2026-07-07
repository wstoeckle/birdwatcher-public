import { useEffect, useState } from 'react';
import type { Sighting } from '../types';
import { cameraLabel, formatWhen } from '../lib';
import { deleteSighting, editSighting } from '../api';
import { fetchReferenceImage, type ReferenceImage } from '../reference';

export function SightingModal({
  sighting,
  onClose,
  onDeleted,
  onUpdated,
  onPrev,
  onNext,
}: {
  sighting: Sighting;
  onClose: () => void;
  onDeleted?: (id: string) => void;
  /** Called with the updated sighting after an admin corrects its species. */
  onUpdated?: (sighting: Sighting) => void;
  /** Open the previous photo in the gallery (← arrow). Omit at the start of the list. */
  onPrev?: () => void;
  /** Open the next photo in the gallery (→ arrow). Omit at the end of the list. */
  onNext?: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose();
      // Don't hijack the arrow keys while someone is typing the admin code.
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') onPrev?.();
      if (e.key === 'ArrowRight') onNext?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);

  // "Show me the bird" — toggles a highlight box over where the camera saw the
  // subject. Reset whenever a different sighting opens.
  const [showBox, setShowBox] = useState(false);
  useEffect(() => {
    setShowBox(false);
  }, [sighting.id]);
  const subjectNoun =
    sighting.kind === 'critter'
      ? /^(person|human)$/i.test(sighting.species)
        ? 'person'
        : 'critter'
      : 'bird';

  // A canonical "what this species looks like" photo, for any non-human sighting.
  const [reference, setReference] = useState<ReferenceImage | null>(null);
  useEffect(() => {
    let alive = true;
    setReference(null);
    fetchReferenceImage(sighting.species, sighting.scientificName, sighting.funFacts).then((r) => {
      if (alive) setReference(r);
    });
    return () => {
      alive = false;
    };
  }, [sighting.species, sighting.scientificName, sighting.funFacts]);
  const referenceSubject = reference?.variantLabel
    ? `${reference.variantLabel} ${sighting.species}`
    : sighting.species;

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={sighting.species}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="modal-photo-wrap">
          <img className="modal-photo" src={sighting.imageUrl} alt={sighting.species} />
          {onPrev && (
            <button
              className="modal-nav modal-nav-prev"
              onClick={onPrev}
              aria-label="Previous photo"
            >
              ‹
            </button>
          )}
          {onNext && (
            <button className="modal-nav modal-nav-next" onClick={onNext} aria-label="Next photo">
              ›
            </button>
          )}
          {sighting.box && showBox && (
            <div
              className="modal-box"
              style={{
                left: `${sighting.box[0] * 100}%`,
                top: `${sighting.box[1] * 100}%`,
                width: `${sighting.box[2] * 100}%`,
                height: `${sighting.box[3] * 100}%`,
              }}
            />
          )}
          {sighting.box && (
            <button className="modal-show-btn" onClick={() => setShowBox((v) => !v)}>
              {showBox ? 'Hide' : `🔍 Show me the ${subjectNoun}`}
            </button>
          )}
        </div>
        <div className="modal-body">
          <h2 className="modal-species">{sighting.species}</h2>
          {sighting.scientificName && <p className="modal-sci">{sighting.scientificName}</p>}
          <p className="modal-when">
            Seen {formatWhen(sighting.capturedAt)}
            {sighting.device ? ` · ${cameraLabel(sighting.device)}` : ''}
            {typeof sighting.confidence === 'number'
              ? ` · ${Math.round(sighting.confidence * 100)}% sure`
              : ''}
          </p>
          {sighting.funFacts.length > 0 && (
            <>
              <h3 className="modal-facts-title">Fun facts</h3>
              <ul className="modal-facts">
                {sighting.funFacts.map((fact, i) => (
                  <li key={i}>{fact}</li>
                ))}
              </ul>
            </>
          )}
          {reference && (
            <div className="modal-reference">
              <h3 className="modal-facts-title">What a {referenceSubject} looks like</h3>
              <img
                className="modal-ref-img"
                src={reference.imageUrl}
                alt={`Reference photo of a ${referenceSubject}`}
                loading="lazy"
              />
              <p className="modal-ref-credit">
                Reference photo from{' '}
                <a href={reference.pageUrl} target="_blank" rel="noreferrer noopener">
                  {reference.sourceName}
                </a>
              </p>
            </div>
          )}
          <div className="modal-admin">
            <EditControl sighting={sighting} onUpdated={onUpdated} />
            <DeleteControl sighting={sighting} onDeleted={onDeleted} onClose={onClose} />
          </div>
        </div>
      </div>
    </div>
  );
}

type EditState = 'idle' | 'editing' | 'saving' | 'badpin' | 'disabled' | 'error';

// An admin "fix the ID" control: enter the new species + the admin code, and the
// server re-derives the scientific name, fun facts, and (via the live Wikipedia
// lookup) the reference photo for the corrected bird. Tucked away like the delete
// control so it stays out of the way for ordinary visitors.
function EditControl({
  sighting,
  onUpdated,
}: {
  sighting: Sighting;
  onUpdated?: (sighting: Sighting) => void;
}) {
  const [state, setState] = useState<EditState>('idle');
  const [species, setSpecies] = useState(sighting.species);
  const [pin, setPin] = useState('');
  const [note, setNote] = useState('');

  // Reset the form whenever a different photo opens (or its species changes).
  useEffect(() => {
    setState('idle');
    setSpecies(sighting.species);
    setPin('');
    setNote('');
  }, [sighting.id, sighting.species]);

  async function save() {
    const next = species.trim();
    if (!next || pin.length < 3 || state === 'saving') return;
    if (next === sighting.species) return setState('idle');
    setState('saving');
    const res = await editSighting(sighting.id, pin, next);
    if (res.badPin) return setState('badpin');
    if (res.disabled) return setState('disabled');
    if (!res.ok || !res.sighting) return setState('error');
    onUpdated?.(res.sighting);
    setPin('');
    setState('idle');
    setNote(
      res.regenerated === false
        ? "Saved — but the AI facts couldn't refresh (check GEMINI_API_KEY)."
        : '',
    );
  }

  if (state === 'idle') {
    return (
      <div className="modal-edit-done">
        <button className="modal-edit" onClick={() => setState('editing')}>
          Edit species
        </button>
        {note && <p className="modal-edit-note">{note}</p>}
      </div>
    );
  }

  return (
    <div className="modal-edit-panel">
      <p className="modal-edit-lead">
        Correct the species. The bio and reference photo refresh too.
      </p>
      <input
        className="modal-edit-species"
        type="text"
        autoComplete="off"
        placeholder="Species, e.g. Northern Cardinal"
        aria-label="Corrected species"
        value={species}
        onChange={(e) => setSpecies(e.target.value)}
        autoFocus
      />
      <div className="modal-edit-row">
        <input
          className="modal-edit-pin"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="Admin code"
          aria-label="Admin code"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
        />
        <button className="modal-edit-go" onClick={save} disabled={state === 'saving'}>
          {state === 'saving' ? 'Saving…' : 'Save'}
        </button>
        <button className="modal-edit-cancel" onClick={() => setState('idle')}>
          Cancel
        </button>
      </div>
      {state === 'badpin' && <p className="modal-edit-err">That code didn't work — try again.</p>}
      {state === 'disabled' && (
        <p className="modal-edit-err">Editing is turned off (no admin code is set up).</p>
      )}
      {state === 'error' && (
        <p className="modal-edit-err">Something went wrong. Try again in a moment.</p>
      )}
    </div>
  );
}

type DeleteState = 'idle' | 'confirming' | 'deleting' | 'badpin' | 'disabled' | 'error';

// A quiet "remove" link tucked at the bottom of the details. Asks for the admin
// code before deleting, so a stray misidentification can be cleared without
// touching the database by hand. Hidden behind a click, so it stays out of the
// way for ordinary visitors.
function DeleteControl({
  sighting,
  onDeleted,
  onClose,
}: {
  sighting: Sighting;
  onDeleted?: (id: string) => void;
  onClose: () => void;
}) {
  const [state, setState] = useState<DeleteState>('idle');
  const [pin, setPin] = useState('');

  async function confirm() {
    if (pin.length < 3 || state === 'deleting') return;
    setState('deleting');
    const res = await deleteSighting(sighting.id, pin);
    if (res.badPin) return setState('badpin');
    if (res.disabled) return setState('disabled');
    if (!res.ok) return setState('error');
    onDeleted?.(sighting.id);
    onClose();
  }

  if (state === 'idle') {
    return (
      <button className="modal-remove" onClick={() => setState('confirming')}>
        Remove this photo
      </button>
    );
  }

  return (
    <div className="modal-remove-panel">
      <p className="modal-remove-lead">Remove this misidentified photo? Enter the admin code.</p>
      <div className="modal-remove-row">
        <input
          className="modal-remove-pin"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="Admin code"
          aria-label="Admin code"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          autoFocus
        />
        <button className="modal-remove-go" onClick={confirm} disabled={state === 'deleting'}>
          {state === 'deleting' ? 'Removing…' : 'Delete'}
        </button>
        <button className="modal-remove-cancel" onClick={() => setState('idle')}>
          Cancel
        </button>
      </div>
      {state === 'badpin' && <p className="modal-remove-err">That code didn't work — try again.</p>}
      {state === 'disabled' && (
        <p className="modal-remove-err">Deleting is turned off (no admin code is set up).</p>
      )}
      {state === 'error' && (
        <p className="modal-remove-err">Something went wrong. Try again in a moment.</p>
      )}
    </div>
  );
}
