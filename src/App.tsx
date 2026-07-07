import { useEffect, useMemo, useState } from 'react';
import type { ActivityReport, Sighting } from './types';
import { fetchActivity, fetchSightings } from './api';
import {
  activityTotals,
  archivedPhotoCount,
  adjacentSightingIds,
  curateSpeciesSightings,
  feederDay,
  mergeSpeciesHistory,
  mergeSightings,
  summarizeCameras,
  normalizeDevice,
} from './lib';
import { CameraFilter } from './components/CameraFilter';
import { SightingCard } from './components/SightingCard';
import { SightingModal } from './components/SightingModal';
import { SpeciesTable } from './components/SpeciesTable';
import { StatBar } from './components/StatBar';
import { CaptureButton } from './components/CaptureButton';
import { ActivityPanel } from './components/DailyLog';
import { SITE_TITLE, SITE_SUBTITLE } from './siteConfig';

// How many sighting cards to show per page, so the gallery doesn't grow into an
// endless scroll as weeks and months of visitors pile up.
const PAGE_SIZE = 50;

export function App() {
  const [sightings, setSightings] = useState<Sighting[]>([]);
  const [critterSightings, setCritterSightings] = useState<Sighting[]>([]);
  const [activity, setActivity] = useState<ActivityReport | null>(null);
  const [critterActivity, setCritterActivity] = useState<ActivityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [usingSeed, setUsingSeed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [speciesFilter, setSpeciesFilter] = useState<string | null>(null);
  const [cameraFilter, setCameraFilter] = useState<string | null>(null);
  const [dayFilter, setDayFilter] = useState<string | null>(null);
  const [fetchedSpecies, setFetchedSpecies] = useState<Set<string>>(() => new Set());
  const [fetchedDays, setFetchedDays] = useState<Set<string>>(() => new Set());
  const [page, setPage] = useState(1);

  useEffect(() => {
    let alive = true;
    fetchSightings('bird').then((res) => {
      if (!alive) return;
      setSightings(res.sightings);
      setUsingSeed(res.usingSeed);
      setLoading(false);
    });
    fetchActivity('bird').then((res) => {
      if (alive) setActivity(res.activity);
    });
    // Critter photos drive the summary in the "Critter patrol" teaser on this page.
    fetchSightings('critter').then((res) => {
      if (alive) setCritterSightings(res.sightings);
    });
    fetchActivity('critter').then((res) => {
      if (alive) setCritterActivity(res.activity);
    });
    return () => {
      alive = false;
    };
  }, []);

  // After someone presses "take a photo now", the Pi needs a moment to capture and
  // post. Re-poll the gallery for the next minute or two so the new shot pops in
  // without a manual refresh.
  const refreshSoon = () => {
    let tries = 0;
    const tick = () => {
      fetchSightings('bird').then((res) => {
        setSightings(res.sightings);
        setUsingSeed(res.usingSeed);
      });
      fetchActivity('bird').then((res) => setActivity(res.activity));
      tries += 1;
      if (tries < 8) window.setTimeout(tick, 12_000);
    };
    window.setTimeout(tick, 8_000);
  };

  useEffect(() => {
    if (!speciesFilter) return;
    let alive = true;
    fetchSightings('bird', { species: speciesFilter }).then((res) => {
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
    fetchSightings('bird', { day: dayFilter }).then((res) => {
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

  // Changing the filter (or losing rows to deletion) can leave us past the last
  // page — keep the current page in range, and jump back to the top on a filter
  // change so the first results are visible.
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  useEffect(() => setPage(1), [speciesFilter, cameraFilter, dayFilter]);
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);
  const paged = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const open = openId ? (sightings.find((s) => s.id === openId) ?? null) : null;
  // Arrow-key / button navigation flips through the full filtered list, in the
  // same newest-first order the gallery shows.
  const { prevId, nextId } = adjacentSightingIds(visible, openId);
  const birds = useMemo(() => activityTotals(activity, sightings), [activity, sightings]);
  const critterStats = useMemo(
    () => activityTotals(critterActivity, critterSightings),
    [critterActivity, critterSightings],
  );

  return (
    <div className="app">
      <header className="site-header">
        <h1 className="site-title">{SITE_TITLE}</h1>
        <p className="site-subtitle">{SITE_SUBTITLE}</p>
        {usingSeed && (
          <p className="seed-banner">
            Showing sample birds — connect the camera and database to see real visitors.
          </p>
        )}
      </header>

      {!loading && (
        <StatBar
          stats={[
            { value: birds.total, label: 'Birds' },
            { value: birds.species, label: 'Species' },
          ]}
        />
      )}

      {!loading && (
        <SpeciesTable
          title="Who's visiting"
          rows={species}
          selected={speciesFilter}
          onSelect={setSpeciesFilter}
          allLabel="All birds"
        />
      )}

      {!loading && (
        <CameraFilter cameras={cameras} selected={cameraFilter} onSelect={setCameraFilter} />
      )}

      {!loading && activity && (
        <ActivityPanel days={activity.days} selectedDay={dayFilter} onSelectDay={setDayFilter} />
      )}

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
                ? 'No bird photos from this camera yet.'
                : 'Getting set up at the feeder — no birds captured yet. Check back soon! 🐦'}
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

      <p className="critters-link-wrap">
        <a className="critters-link" href="/alerts">
          🔔 Text me bird alerts
        </a>
      </p>

      <section className="critters-teaser" aria-label="Critter summary">
        <h2 className="critters-teaser-title">🐾 Critter patrol</h2>
        <StatBar
          stats={[
            { value: critterStats.total, label: 'Critters' },
            { value: critterStats.species, label: 'Species' },
          ]}
        />
        <a className="critters-link" href="/critters">
          See who else stopped by →
        </a>
      </section>

      <CaptureButton onRequested={refreshSoon} />

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
        <p>
          {species.length} species · {sightings.length} sightings
        </p>
        <p className="footer-links">
          <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
        </p>
      </footer>
    </div>
  );
}
