import type { Sighting, CritterCount } from './types';

// Built-in sample sightings so the gallery looks alive before any hardware or
// database exists. Photos are royalty-free Unsplash images. The API falls back
// to these whenever DATABASE_URL is not configured.

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3600_000).toISOString();
}

export const SEED_SIGHTINGS: Sighting[] = [
  {
    id: 'seed-1',
    capturedAt: hoursAgo(2),
    species: 'Northern Cardinal',
    scientificName: 'Cardinalis cardinalis',
    confidence: 0.96,
    imageUrl:
      'https://images.unsplash.com/photo-1615146101981-cf25d1a1e6a1?auto=format&fit=crop&w=1200&q=70',
    device: 'backyard-feeder',
    funFacts: [
      'Only male cardinals are bright red — females are a warm tan with red accents.',
      'They don’t migrate, so you can spot them at the feeder all winter long.',
      'A group of cardinals is called a "college" or a "radiance".',
    ],
  },
  {
    id: 'seed-2',
    capturedAt: hoursAgo(6),
    species: 'Blue Jay',
    scientificName: 'Cyanocitta cristata',
    confidence: 0.93,
    imageUrl:
      'https://images.unsplash.com/photo-1591608971362-f08b2a75731a?auto=format&fit=crop&w=1200&q=70',
    device: 'backyard-feeder',
    funFacts: [
      'Blue jays aren’t actually blue — the color comes from light scattering in their feathers.',
      'They can mimic the calls of hawks to scare other birds away from food.',
      'Jays help forests grow by burying thousands of acorns each autumn.',
    ],
  },
  {
    id: 'seed-3',
    capturedAt: hoursAgo(20),
    species: 'American Goldfinch',
    scientificName: 'Spinus tristis',
    confidence: 0.91,
    imageUrl:
      'https://images.unsplash.com/photo-1444464666168-49d633b86797?auto=format&fit=crop&w=1200&q=70',
    device: 'backyard-feeder',
    funFacts: [
      'Goldfinches are strict vegetarians — almost their entire diet is seeds.',
      'They’re one of the latest nesting birds, waiting for thistle down in midsummer.',
      'In winter the males trade their lemon-yellow for a drab olive coat.',
    ],
  },
  {
    id: 'seed-4',
    capturedAt: hoursAgo(28),
    species: 'Black-capped Chickadee',
    scientificName: 'Poecile atricapillus',
    confidence: 0.89,
    imageUrl:
      'https://images.unsplash.com/photo-1611689342806-0863700ce1e4?auto=format&fit=crop&w=1200&q=70',
    device: 'backyard-feeder',
    funFacts: [
      'Their "chick-a-dee" call adds more "dee" notes when a bigger threat is near.',
      'Each fall they grow new brain cells to remember thousands of food hiding spots.',
      'They’re bold enough to be trained to eat from an outstretched hand.',
    ],
  },
  {
    id: 'seed-5',
    capturedAt: hoursAgo(50),
    species: 'Mourning Dove',
    scientificName: 'Zenaida macroura',
    confidence: 0.94,
    imageUrl:
      'https://images.unsplash.com/photo-1606567595334-d39972c85dbe?auto=format&fit=crop&w=1200&q=70',
    device: 'backyard-feeder',
    funFacts: [
      'The soft "coo" that sounds mournful is actually a male’s courtship song.',
      'Their whistling takeoff is made by air rushing through their wing feathers.',
      'Parents feed chicks "crop milk", a rich liquid produced in the throat.',
    ],
  },
  {
    id: 'seed-6',
    capturedAt: hoursAgo(72),
    species: 'Downy Woodpecker',
    scientificName: 'Dryobates pubescens',
    confidence: 0.88,
    imageUrl:
      'https://images.unsplash.com/photo-1574068468668-a05a11f871da?auto=format&fit=crop&w=1200&q=70',
    device: 'backyard-feeder',
    funFacts: [
      'It’s the smallest woodpecker in North America — barely bigger than a sparrow.',
      'Stiff tail feathers prop it up like a kickstand while it hammers away.',
      'Only the males have the little red patch on the back of the head.',
    ],
  },
];

// Sample critter tallies so the counter looks alive in the seed/preview state.
export const SEED_CRITTERS: CritterCount[] = [
  { species: 'squirrel', count: 543, lastSeen: hoursAgo(1) },
  { species: 'chipmunk', count: 87, lastSeen: hoursAgo(5) },
  { species: 'rabbit', count: 12, lastSeen: hoursAgo(26) },
];
