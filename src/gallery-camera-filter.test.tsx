import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { CrittersPage } from './CrittersPage';
import type { ActivityReport, Sighting } from './types';

function sighting(
  id: string,
  species: string,
  device: string,
  kind: 'bird' | 'critter',
  capturedAt = `2026-06-28T12:0${id}:00Z`,
): Sighting {
  return {
    id,
    species,
    device,
    kind,
    capturedAt,
    funFacts: [],
    imageUrl: `https://example.com/${id}.jpg`,
  };
}

function mockFetch(
  birds: Sighting[],
  critters: Sighting[],
  activity: Partial<Record<'bird' | 'critter', ActivityReport>> = {},
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      const kind = path.includes('kind=critter') ? 'critter' : 'bird';
      const rows = kind === 'critter' ? critters : birds;
      const parsed = new URL(path, 'https://example.com');
      const day = parsed.searchParams.get('day');
      if (path.includes('/api/activity')) {
        return Response.json(
          activity[kind] ?? { totals: { total: 0, species: 0 }, species: [], days: [] },
        );
      }
      if (path.includes('/api/critters')) {
        return Response.json({ critters: [] });
      }
      return Response.json({
        sightings: day ? rows.filter((s) => s.capturedAt.slice(0, 10) === day) : rows,
      });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('gallery camera filters', () => {
  it('filters the bird gallery by camera', async () => {
    mockFetch(
      [
        sighting('1', 'Blue Jay', 'feeder-pi', 'bird'),
        sighting('2', 'Owl', 'yard-reolink', 'bird'),
      ],
      [],
    );

    render(<App />);

    expect(await screen.findByRole('button', { name: /Reolink 1/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Reolink 1/i }));

    const gallery = screen.getByRole('main');
    expect(within(gallery).getByRole('heading', { name: 'Owl' })).toBeInTheDocument();
    expect(within(gallery).queryByRole('heading', { name: 'Blue Jay' })).not.toBeInTheDocument();
  });

  it('filters the critter gallery by camera', async () => {
    mockFetch(
      [],
      [
        sighting('3', 'Domestic Dog', 'yard-reolink', 'critter'),
        sighting('4', 'Eastern Gray Squirrel', 'feeder-cam', 'critter'),
      ],
    );

    render(<CrittersPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Pi camera 1/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Pi camera 1/i }));

    const gallery = screen.getByRole('main');
    expect(
      within(gallery).getByRole('heading', { name: 'Eastern Gray Squirrel' }),
    ).toBeInTheDocument();
    expect(
      within(gallery).queryByRole('heading', { name: 'Domestic Dog' }),
    ).not.toBeInTheDocument();
  });

  it('filters the bird gallery from the activity calendar', async () => {
    // The calendar opens on the CURRENT month, so this test breaks whenever real
    // time leaves June 2026 unless we pin the clock to match the fixtures. Fake
    // only Date — waitFor/findBy rely on real timers.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-06-28T15:00:00Z') });
    mockFetch(
      [
        sighting('1', 'Blue Jay', 'feeder-pi', 'bird', '2026-06-28T12:01:00Z'),
        sighting('2', 'Owl', 'yard-reolink', 'bird', '2026-06-27T12:02:00Z'),
      ],
      [],
      {
        bird: {
          totals: { total: 2, species: 2 },
          species: [
            { species: 'Blue Jay', count: 1, lastSeen: '2026-06-28T12:01:00Z' },
            { species: 'Owl', count: 1, lastSeen: '2026-06-27T12:02:00Z' },
          ],
          days: [
            { day: '2026-06-28', total: 1, species: [{ species: 'Blue Jay', count: 1 }] },
            { day: '2026-06-27', total: 1, species: [{ species: 'Owl', count: 1 }] },
          ],
        },
      },
    );

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /Jun 28: 1 sightings/i }));

    const gallery = screen.getByRole('main');
    expect(within(gallery).getByRole('heading', { name: 'Blue Jay' })).toBeInTheDocument();
    expect(within(gallery).queryByRole('heading', { name: 'Owl' })).not.toBeInTheDocument();
  });
});
