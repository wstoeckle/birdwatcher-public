import { describe, it, expect } from 'vitest';
import {
  summarizeSpecies,
  formatWhen,
  pluralize,
  sightingTotals,
  adjacentSightingIds,
  summarizeCameras,
  mergeSpeciesHistory,
  activityTotals,
  mergeSightings,
  archivedPhotoCount,
  curateSpeciesSightings,
  feederDay,
} from './lib';
import type { Sighting } from './types';

function make(id: string, species: string, capturedAt: string): Sighting {
  return { id, species, capturedAt, funFacts: [], imageUrl: `https://x/${id}.jpg` };
}

describe('feederDay', () => {
  it('formats sightings in the feeder timezone', () => {
    expect(feederDay('2026-06-28T03:30:00Z')).toBe('2026-06-27');
  });
});

describe('summarizeSpecies', () => {
  it('groups by species, counts, and tracks the most recent photo', () => {
    const sightings = [
      make('a', 'Blue Jay', '2026-06-01T10:00:00Z'),
      make('b', 'Blue Jay', '2026-06-01T12:00:00Z'),
      make('c', 'Cardinal', '2026-06-01T11:00:00Z'),
    ];
    const summary = summarizeSpecies(sightings);
    expect(summary).toHaveLength(2);
    // Sorted by most-recent sighting first → Blue Jay (12:00) before Cardinal (11:00).
    expect(summary[0]).toMatchObject({
      species: 'Blue Jay',
      count: 2,
      imageUrl: 'https://x/b.jpg',
    });
    expect(summary[1]).toMatchObject({ species: 'Cardinal', count: 1 });
  });

  it('returns an empty list for no sightings', () => {
    expect(summarizeSpecies([])).toEqual([]);
  });
});

describe('mergeSpeciesHistory', () => {
  it('uses durable counts and attaches thumbnails from retained photos', () => {
    const sightings = [
      make('a', 'Blue Jay', '2026-06-01T10:00:00Z'),
      make('b', 'Cardinal', '2026-06-01T11:00:00Z'),
    ];
    const summary = mergeSpeciesHistory(
      [
        { species: 'Blue Jay', count: 99, lastSeen: '2026-06-28T10:00:00Z' },
        { species: 'American Robin', count: 42, lastSeen: '2026-06-27T10:00:00Z' },
      ],
      sightings,
    );

    expect(summary).toEqual([
      {
        species: 'Blue Jay',
        count: 99,
        lastSeen: '2026-06-28T10:00:00Z',
        imageUrl: 'https://x/a.jpg',
      },
      {
        species: 'American Robin',
        count: 42,
        lastSeen: '2026-06-27T10:00:00Z',
        imageUrl: undefined,
      },
    ]);
  });
});

describe('mergeSightings', () => {
  it('adds older species-specific fetches without duplicating existing photos', () => {
    expect(
      mergeSightings(
        [
          make('a', 'Blue Jay', '2026-06-28T12:00:00Z'),
          make('b', 'Monk Parakeet', '2026-06-25T12:00:00Z'),
        ],
        [
          make('b', 'Monk Parakeet', '2026-06-25T12:00:00Z'),
          make('c', 'Monk Parakeet', '2026-06-24T12:00:00Z'),
        ],
      ).map((s) => s.id),
    ).toEqual(['a', 'b', 'c']);
  });
});

describe('curateSpeciesSightings', () => {
  it('shows every photo for species with five or fewer historical sightings', () => {
    const photos = [
      make('old', 'Monk Parakeet', '2026-04-01T12:00:00Z'),
      make('new', 'Monk Parakeet', '2026-06-28T12:00:00Z'),
    ];

    expect(
      curateSpeciesSightings(photos, 2, new Date('2026-06-28T12:00:00Z')).map((s) => s.id),
    ).toEqual(['new', 'old']);
  });

  it('keeps all recent photos plus the best older photos for common species', () => {
    const photos = [
      { ...make('recent', 'Common Grackle', '2026-06-25T12:00:00Z'), confidence: 0.3 },
      { ...make('older-best', 'Common Grackle', '2026-04-01T12:00:00Z'), confidence: 0.9 },
      {
        ...make('older-boxed', 'Common Grackle', '2026-04-02T12:00:00Z'),
        confidence: 0.8,
        box: [0, 0, 1, 1] as [number, number, number, number],
      },
      { ...make('older-weak', 'Common Grackle', '2026-04-03T12:00:00Z'), confidence: 0.1 },
      { ...make('older-2', 'Common Grackle', '2026-04-04T12:00:00Z'), confidence: 0.2 },
      { ...make('older-3', 'Common Grackle', '2026-04-05T12:00:00Z'), confidence: 0.3 },
      { ...make('older-4', 'Common Grackle', '2026-04-06T12:00:00Z'), confidence: 0.4 },
      { ...make('older-5', 'Common Grackle', '2026-04-07T12:00:00Z'), confidence: 0.5 },
    ];

    expect(
      curateSpeciesSightings(photos, 20, new Date('2026-06-28T12:00:00Z')).map((s) => s.id),
    ).toEqual(['recent', 'older-5', 'older-4', 'older-3', 'older-boxed', 'older-best']);
  });
});

describe('archivedPhotoCount', () => {
  it('reports historical sightings missing from retained photo rows', () => {
    expect(archivedPhotoCount(20, 12)).toBe(8);
    expect(archivedPhotoCount(3, 5)).toBe(0);
  });
});

describe('summarizeCameras', () => {
  it('groups by device, labels known cameras, and skips expiring snapshots', () => {
    const sightings = [
      { ...make('a', 'Blue Jay', '2026-06-01T10:00:00Z'), device: 'feeder-pi' },
      { ...make('b', 'Blue Jay', '2026-06-01T12:00:00Z'), device: 'yard-reolink' },
      { ...make('c', 'Cardinal', '2026-06-01T11:00:00Z'), device: 'feeder-pi' },
      { ...make('f', 'Robin', '2026-06-01T13:00:00Z'), device: 'feeder-cam' },
      {
        ...make('d', 'Mystery', '2026-06-01T13:00:00Z'),
        device: 'yard-reolink',
        expiresAt: '2026-06-01T13:30:00Z',
      },
      make('e', 'Robin', '2026-06-01T14:00:00Z'),
    ];

    expect(summarizeCameras(sightings)).toEqual([
      {
        device: 'feeder-pi',
        label: 'Pi camera',
        count: 3,
        lastSeen: '2026-06-01T13:00:00Z',
      },
      {
        device: 'yard-reolink',
        label: 'Reolink',
        count: 1,
        lastSeen: '2026-06-01T12:00:00Z',
      },
    ]);
  });
});

describe('pluralize', () => {
  it('leaves singular alone and adds the right suffix', () => {
    expect(pluralize('squirrel', 1)).toBe('squirrel');
    expect(pluralize('squirrel', 543)).toBe('squirrels');
    expect(pluralize('fox', 3)).toBe('foxes');
    expect(pluralize('bunny', 2)).toBe('bunnies');
    expect(pluralize('deer', 4)).toBe('deer');
  });
});

describe('sightingTotals', () => {
  it('counts photos and distinct species, ignoring expiring snapshots', () => {
    const totals = sightingTotals([
      make('a', 'Blue Jay', '2026-06-01T10:00:00Z'),
      make('b', 'Blue Jay', '2026-06-01T12:00:00Z'),
      make('c', 'Cardinal', '2026-06-01T11:00:00Z'),
      { ...make('d', 'Mystery', '2026-06-01T13:00:00Z'), expiresAt: '2026-06-01T13:30:00Z' },
    ]);
    expect(totals).toEqual({ total: 3, species: 2 });
  });

  it('is zero for an empty gallery', () => {
    expect(sightingTotals([])).toEqual({ total: 0, species: 0 });
  });
});

describe('activityTotals', () => {
  it('prefers durable totals when present', () => {
    expect(
      activityTotals(
        { totals: { total: 500, species: 12 }, species: [], days: [] },
        [make('a', 'Blue Jay', '2026-06-01T10:00:00Z')],
      ),
    ).toEqual({ total: 500, species: 12 });
  });
});

describe('adjacentSightingIds', () => {
  const list = [
    make('a', 'Blue Jay', '2026-06-01T12:00:00Z'),
    make('b', 'Cardinal', '2026-06-01T11:00:00Z'),
    make('c', 'Robin', '2026-06-01T10:00:00Z'),
  ];

  it('finds neighbors in the middle of the list', () => {
    expect(adjacentSightingIds(list, 'b')).toEqual({ prevId: 'a', nextId: 'c' });
  });

  it('has no previous at the start and no next at the end', () => {
    expect(adjacentSightingIds(list, 'a')).toEqual({ prevId: null, nextId: 'b' });
    expect(adjacentSightingIds(list, 'c')).toEqual({ prevId: 'b', nextId: null });
  });

  it('returns nulls when nothing is open or the id is missing', () => {
    expect(adjacentSightingIds(list, null)).toEqual({ prevId: null, nextId: null });
    expect(adjacentSightingIds(list, 'zzz')).toEqual({ prevId: null, nextId: null });
  });
});

describe('formatWhen', () => {
  it('labels today and yesterday', () => {
    const now = new Date();
    expect(formatWhen(now.toISOString())).toMatch(/^Today at /);
    const yesterday = new Date(now.getTime() - 86_400_000);
    expect(formatWhen(yesterday.toISOString())).toMatch(/^Yesterday at /);
  });
});
