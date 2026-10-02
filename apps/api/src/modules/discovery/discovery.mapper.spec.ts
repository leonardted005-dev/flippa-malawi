import { extractCardMetrics, pickMetadata, toListingCardView } from './discovery.mapper';

function asset(type: string, metadata: Record<string, unknown> | null, extra = {}) {
  return {
    id: 'a',
    type,
    slug: 's',
    title: 'T',
    country: 'ZM',
    verificationStatus: 'UNVERIFIED',
    qualityStatus: 'PENDING',
    ...extra,
    software: null,
    website: null,
    mobile: null,
    youtube: null,
    instagram: null,
    game: null,
    domain: null,
    [metadataKey(type)]: metadata,
  } as Record<string, unknown>;
}

function metadataKey(type: string): string {
  switch (type) {
    case 'SOFTWARE':
      return 'software';
    case 'WEBSITE':
      return 'website';
    case 'MOBILE_APP':
      return 'mobile';
    case 'YOUTUBE_CHANNEL':
      return 'youtube';
    case 'INSTAGRAM_PROFILE':
      return 'instagram';
    case 'GAME_ACCOUNT':
      return 'game';
    case 'DOMAIN':
      return 'domain';
    default:
      return 'extra';
  }
}

describe('discovery card mapper', () => {
  it('selects the one non-null metadata row', () => {
    const website = asset('WEBSITE', { domain: 'a.co.zm' });
    expect(pickMetadata(website)).toMatchObject({ domain: 'a.co.zm' });
  });

  it('only exposes metrics the registry declares for the kind', () => {
    const website = asset('WEBSITE', {
      domain: 'a.co.zm',
      monthlyRevenueMinor: 125_000n,
      monthlyTraffic: 9000,
      subscribers: 42,
    });
    const metrics = extractCardMetrics(website);

    expect(metrics['revenue']).toBe('125000'); // bigint serialised as string
    expect(metrics['traffic']).toBe(9000);
    expect(metrics['subscribers']).toBeUndefined(); // not a website metric
    expect(metrics['followers']).toBeUndefined();
  });

  it('never shows revenue for software assets', () => {
    const software = asset('SOFTWARE', {
      packageSizeBytes: 2048n,
      monthlyRevenueMinor: 999_999n,
      subscribers: 7,
    });
    const metrics = extractCardMetrics(software);

    expect(metrics['revenue']).toBeUndefined();
    expect(metrics['subscribers']).toBeUndefined();
    expect(metrics['packageSizeBytes']).toBeUndefined();
    expect(metrics).toEqual({});
  });

  it('hides slots that have no real value instead of zero-filling', () => {
    const youtube = asset('YOUTUBE_CHANNEL', { channelId: 'UC123' });
    const metrics = extractCardMetrics(youtube);

    expect(metrics).toEqual({});
    expect('subscribers' in metrics).toBe(false);

    const withValues = extractCardMetrics(
      asset('YOUTUBE_CHANNEL', { channelId: 'UC123', subscribers: 1500 }),
    );
    expect(withValues['subscribers']).toBe(1500);
    expect(withValues['revenue']).toBeUndefined();
  });

  it('maps engagement as a bounded integer for Instagram', () => {
    const metrics = extractCardMetrics(
      asset('INSTAGRAM_PROFILE', { accountId: 'zed', followers: 5000, engagementBps: 320 }),
    );
    expect(metrics['followers']).toBe(5000);
    expect(metrics['engagement']).toBe(320);
    expect(metrics['revenue']).toBeUndefined();
  });

  it('hides empty collections and blank strings instead of rendering empty slots', () => {
    const metrics = extractCardMetrics(
      asset('WEBSITE', { domain: 'a.co.zm', technology: [], hosting: '   ', monthlyTraffic: 0 }),
    );

    expect('technology' in metrics).toBe(false);
    // zero is a real value for a counter, so it is kept
    expect(metrics['traffic']).toBe(0);
  });

  it('builds a card without crashing and marks featured from expiresAt', () => {
    const listing = {
      id: 'l1',
      mode: 'FIXED_PRICE',
      status: 'ACTIVE',
      priceMinor: 250_000n,
      currency: 'ZMW',
      startsAt: null,
      endsAt: null,
      publishedAt: new Date('2026-10-01T00:00:00Z'),
      featuredUntil: new Date(Date.now() + 60_000),
      asset: asset('WEBSITE', { domain: 'a.co.zm', monthlyTraffic: 100 }),
      seller: {
        id: 's1',
        displayName: 'Zed Crafts',
        tierCode: 'FREE_CODER',
        country: 'ZM',
        ratingAvgBp: 480,
        ratingCount: 12,
      },
      attachments: [],
    };

    const card = toListingCardView(listing);
    expect(card['priceMinor']).toBe('250000');
    expect(card['featured']).toBe(true);
    expect((card['asset'] as Record<string, unknown>)['type']).toBe('WEBSITE');
    expect((card['seller'] as Record<string, unknown>)['displayName']).toBe('Zed Crafts');
    expect(card['metrics']).toMatchObject({ traffic: 100 });
    expect(card['heroImage']).toBeNull();
  });
});
