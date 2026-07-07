import { useEffect, useMemo, useState } from 'react';
import type { ActivityReport, Sighting, CritterCount } from './types';
import { fetchActivity, fetchSightings, fetchCritters } from './api';
import {
  activityTotals,
  archivedPhotoCount,
  curateSpeciesSightings,
  feederDay,
  mergeSpeciesHistory,
  mergeSightings,
  adjacentSightingIds,
  summarizeCameras,
  normalizeDevice,
} from './lib';
import { CameraFilter } from './components/CameraFilter';
import { SightingCard } from './components/SightingCard';
import { SightingModal } from './components/SightingModal';
import { StatBar } from './components/StatBar';
import { SpeciesTable } from './components/SpeciesTable';
import { CritterCounter } from './components/CritterCounter';
import { ActivityPanel } from './components/DailyLog';

// Cap the gallery at one page so it doesn't grow into an endless scroll over
// time — same as the bird page.
const PAGE_SIZE = 50;

// The non-bird sub-page: the running tally of who's stopped by, plus photos of
// the animals (and people) the camera caught that weren't birds.
export function CrittersPage() {
  const [sightings, setSightings] = useState<Sighting[]>([]);
  const [critters, setCritters] = useState<CritterCount[]>([]);
  const [activity, setActivity] = useState<ActivityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [speciesFilter, setSpeciesFilter] = useState<string | null>(null);
  const [cameraFilter, setCameraFilter] = useState<string | null>(null);
  const [dayFilter, setDayFilter] = useState<string | null>(null);
  const [fetchedSpecies, setFetchedSpecies] = useState<Set<string>>(() => new Set());
  const [fetchedDays, setFetchedDays] = useState<Set<string>>(() => new Set());
  const [page, setPage] = useState(1);

  useEffect(() => {
    let alive = true;
    fetchSightings('critter').then((res) => {
      if (!alive) return;
      setSightings(res.sightings);
      setLoading(false);
    });
    fetchCritters().then((res) => {
      if (alive) setCritters(res.critters);
    });
    fetchActivity('critter').then((res) => {
      if (alive) setActivity(res.activity);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!speciesFilter) return;
    let alive = true;
    fetchSightings('critter', { species: speciesFilter }).then((res) => {
      if (!alive) return;
      setSightings((prev) => mergeSightings(prev, res.sightings));
      setFetchedSpecies((prev) => new Set(prev).add(speciesFilter));
    });
    return () => {
      alive = false;
    };
  }, [speciesFilter]);

  useEffect(() => {
    if (!dayFilter) return;
    let alive = true;
    fetchSightings('critter', { day: dayFilter }).then((res) => {
      if (!alive) return;
      setSightings((prev) => mergeSightings(prev, res.sightings));
      setFetchedDays((prev) => new Set(prev).add(dayFilter));
    });
    return () => {
      alive = false;
    };
  }, [dayFilter]);

  const species = useMemo(() => mergeSpeciesHistory(activity?.species, sightings), [activity, sightings]);
  const cameras = useMemo(() => summarizeCameras(sightings), [sightings]);
  const selectedSpecies = useMemo(
    () => species.find((row) => row.species === speciesFilter) ?? null,
    [species, speciesFilter],
  );
  const retainedSpeciesPhotos = useMemo(
    () =>
      speciesFilter
        ? sightings.filter((s) => !s.expiresAt && s.species === speciesFilter).length
        : 0,
    [sightings, speciesFilter],
  );
  const baseVisible = useMemo(
    () =>
      [...sightings]
        .filter((s) => !speciesFilter || s.species === speciesFilter)
        .filter((s) => !dayFilter || feederDay(s.capturedAt) === dayFilter)
        .filter((s) => !cameraFilter || (s.device && normalizeDevice(s.device) === cameraFilter))
        .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)),
    [sightings, speciesFilter, dayFilter, cameraFilter],
  );
  const visible = useMemo(
    () =>
      speciesFilter && selectedSpecies && !dayFilter
        ? curateSpeciesSightings(baseVisible, selectedSpecies.count)
        : baseVisible,
    [baseVisible, selectedSpecies, speciesFilter, dayFilter],
  );
  const speciesPhotosFetched = Boolean(speciesFilter && fetchedSpecies.has(speciesFilter));
  const dayPhotosFetched = Boolean(dayFilter && fetchedDays.has(dayFilter));
  const archivedPhotos =
    speciesPhotosFetched && selectedSpecies && !dayFilter
      ? archivedPhotoCount(selectedSpecies.count, retainedSpeciesPhotos)
      : 0;
  const hiddenOlderPhotos =
    speciesFilter && !dayFilter ? Math.max(0, baseVisible.length - visible.length) : 0;

  // Keep the page in range and snap back to the top when the filter changes.
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  useEffect(() => setPage(1), [speciesFilter, cameraFilter, dayFilter]);
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);
  const paged = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const open = openId ? (sightings.find((s) => s.id === openId) ?? null) : null;
  const { prevId, nextId } = adjacentSightingIds(visible, openId);
  const stats = useMemo(() => activityTotals(activity, sightings), [activity, sightings]);

  return (
    <div className="app">
      <div className="subpage-nav">
        <a className="back-link" href="/">
          ← Back to the birds
        </a>
      </div>

      {!loading && (
        <StatBar
          stats={[
            { value: stats.total, label: 'Critters' },
            { value: stats.species, label: 'Species' },
          ]}
        />
      )}

      <CritterCounter critters={critters} />

      {!loading && (
        <SpeciesTable
          title="Who's visiting"
          rows={species}
          selected={speciesFilter}
          onSelect={setSpeciesFilter}
          allLabel="All critters"
        />
      )}

      {!loading && (
        <CameraFilter cameras={cameras} selected={cameraFilter} onSelect={setCameraFilter} />
      )}

      {!loading && activity && (
        <ActivityPanel days={activity.days} selectedDay={dayFilter} onSelectDay={setDayFilter} />
      )}

      <h2 className="critters-gallery-title">📸 Caught on camera</h2>
      <main className="gallery-wrap">
        {!loading && speciesFilter && (archivedPhotos > 0 || hiddenOlderPhotos > 0) && (
          <p className="archive-note">
            {archivedPhotos > 0
              ? `${archivedPhotos.toLocaleString()} additional photos have been archived.`
              : null}
            {archivedPhotos > 0 && hiddenOlderPhotos > 0 ? ' ' : null}
            {hiddenOlderPhotos > 0
              ? `${hiddenOlderPhotos.toLocaleString()} older retained photos are hidden; showing recent photos and the best older shots.`
              : null}
          </p>
        )}
        {loading ? (
          <p className="empty">Loading recent visitors…</p>
        ) : visible.length === 0 ? (
          <p className="empty">
            {dayFilter && !dayPhotosFetched
              ? 'Loading photos from this day…'
              : dayFilter
                ? 'No retained photos match this day and filter.'
                : speciesFilter
              ? `No ${speciesFilter} photos match this camera filter yet.`
              : cameraFilter
                ? 'No critter photos from this camera yet.'
                : 'No non-bird photos yet — the squirrels are camera-shy. 🐿️'}
          </p>
        ) : (
          <>
            <div className="gallery">
              {paged.map((s) => (
                <SightingCard key={s.id} sighting={s} onOpen={() => setOpenId(s.id)} />
              ))}
            </div>
            {pageCount > 1 && (
              <nav className="pagination" aria-label="Gallery pages">
                <button
                  className="page-btn"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  ← Newer
                </button>
                <span className="page-info">
                  Page {page} of {pageCount}
                </span>
                <button
                  className="page-btn"
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={page >= pageCount}
                >
                  Older →
                </button>
              </nav>
            )}
          </>
        )}
      </main>

      {open && (
        <SightingModal
          sighting={open}
          onClose={() => setOpenId(null)}
          onDeleted={(id) => setSightings((prev) => prev.filter((s) => s.id !== id))}
          onUpdated={(u) => setSightings((prev) => prev.map((s) => (s.id === u.id ? u : s)))}
          onPrev={prevId ? () => setOpenId(prevId) : undefined}
          onNext={nextId ? () => setOpenId(nextId) : undefined}
        />
      )}

      <footer className="site-footer">
        <p>{sightings.length} non-bird sightings</p>
      </footer>
    </div>
  );
}
