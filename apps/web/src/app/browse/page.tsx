import Link from 'next/link';

import { ListingCard } from '@/components/listing-card';
import { fetchBrowse } from '@/lib/discovery';

export const dynamic = 'force-dynamic';

const SORTS = [
  { value: 'newest', label: 'Recently added' },
  { value: 'ending_soon', label: 'Ending soon' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
] as const;

const TYPES = [
  'SOFTWARE',
  'WEBSITE',
  'MOBILE_APP',
  'YOUTUBE_CHANNEL',
  'INSTAGRAM_PROFILE',
  'GAME_ACCOUNT',
  'DOMAIN',
] as const;

interface BrowsePageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function BrowsePage({ searchParams }: BrowsePageProps) {
  const assetType = single(searchParams['assetType']);
  const country = single(searchParams['country']);
  const q = single(searchParams['q']);
  const sort = single(searchParams['sort']) ?? 'newest';

  const data = await fetchBrowse({ assetType, country, q, sort, limit: 24 }).catch(() => null);

  return (
    <main className="fa-container">
      <header className="fa-browse__head">
        <h1>Browse digital assets</h1>
        <p className="fa-muted">
          Server-side filtered and sorted across {data?.results.length ?? 0} active listings.
        </p>
      </header>

      <form className="fa-card fa-browse__filters" method="get">
        <label>
          Search
          <input name="q" defaultValue={q ?? ''} placeholder="Title or summary" />
        </label>
        <label>
          Asset type
          <select name="assetType" defaultValue={assetType ?? ''}>
            <option value="">All types</option>
            {TYPES.map((type) => (
              <option key={type} value={type}>
                {type.replaceAll('_', ' ').toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <label>
          Country
          <input name="country" defaultValue={country ?? ''} maxLength={2} placeholder="ZM" />
        </label>
        <label>
          Sort
          <select name="sort" defaultValue={sort}>
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Apply filters</button>
      </form>

      {data === null ? (
        <p className="fa-chip fa-chip--warn">Marketplace data is unavailable right now.</p>
      ) : data.results.length === 0 ? (
        <p className="fa-muted">No listings match these filters yet.</p>
      ) : (
        <div className="fa-listing-grid">
          {data.results.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}

      <p className="fa-muted" style={{ marginTop: 16 }}>
        {data?.pageInfo.hasMore
          ? 'More results available — refine your filters.'
          : 'End of results.'}{' '}
        <Link href="/">Back to home</Link>
      </p>
    </main>
  );
}
