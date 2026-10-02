import { formatCount, formatMoney, type ListingCardDto } from '@/lib/discovery';

const ASSET_TYPE_LABELS: Record<string, string> = {
  SOFTWARE: 'Software',
  WEBSITE: 'Website',
  MOBILE_APP: 'Mobile App',
  YOUTUBE_CHANNEL: 'YouTube',
  INSTAGRAM_PROFILE: 'Instagram',
  GAME_ACCOUNT: 'Game Account',
  DOMAIN: 'Domain',
  OTHER: 'Other',
};

/**
 * Marketplace listing card (docs/MARKETPLACE_UX_ARCHITECTURE.md §3).
 *
 * Rules enforced here:
 *  - only metrics the API declared applicable are rendered (no zero-filling);
 *  - verification/quality chips carry TEXT labels, never colour-only meaning;
 *  - price is the visual anchor, numerals are tabular for grid alignment.
 */
export function ListingCard({ listing }: { listing: ListingCardDto }) {
  const metrics = listing.metrics;
  const facts: Array<{ label: string; value: string }> = [];

  const revenue = formatCount(metrics.revenue);
  if (revenue !== null && metrics.revenue !== undefined) {
    facts.push({ label: 'Revenue / mo', value: formatMoney(metrics.revenue, listing.currency) });
  }
  const traffic = formatCount(metrics.traffic);
  if (traffic !== null) facts.push({ label: 'Traffic / mo', value: traffic });
  const subscribers = formatCount(metrics.subscribers);
  if (subscribers !== null) facts.push({ label: 'Subscribers', value: subscribers });
  const views = formatCount(metrics.views);
  if (views !== null) facts.push({ label: 'Views', value: views });
  const followers = formatCount(metrics.followers);
  if (followers !== null) facts.push({ label: 'Followers', value: followers });
  const installs = formatCount(metrics.installs);
  if (installs !== null) facts.push({ label: 'Installs', value: installs });
  if (metrics.engagement !== undefined) {
    facts.push({ label: 'Engagement', value: `${(metrics.engagement / 100).toFixed(2)}%` });
  }
  if (metrics.levelRank) facts.push({ label: 'Level / Rank', value: metrics.levelRank });
  if (metrics.technology && metrics.technology.length > 0) {
    facts.push({ label: 'Technology', value: metrics.technology.slice(0, 3).join(', ') });
  }
  if (metrics.age !== undefined) facts.push({ label: 'Age', value: `${metrics.age} days` });

  const isAuction = listing.mode === 'AUCTION';

  return (
    <article className="fa-card fa-listing-card">
      <header className="fa-listing-card__head">
        <span className="fa-chip">
          {ASSET_TYPE_LABELS[listing.asset.type] ?? listing.asset.type}
        </span>
        <span className="fa-chip">{listing.asset.country}</span>
        {listing.featured ? <span className="fa-chip fa-chip--accent">Featured</span> : null}
      </header>

      <h3 className="fa-listing-card__title">{listing.asset.title}</h3>

      <p className="fa-listing-card__price tabular">
        {isAuction ? 'Current bid ' : ''}
        {formatMoney(listing.priceMinor, listing.currency)}
      </p>

      <div className="fa-listing-card__chips">
        <span
          className={
            listing.asset.verificationStatus === 'VERIFIED' ? 'fa-chip fa-chip--ok' : 'fa-chip'
          }
        >
          {listing.asset.verificationStatus === 'VERIFIED'
            ? 'Verified'
            : listing.asset.verificationStatus === 'IN_REVIEW'
              ? 'Verification in review'
              : 'Unverified'}
        </span>
        <span
          className={listing.asset.qualityStatus === 'PASS' ? 'fa-chip fa-chip--ok' : 'fa-chip'}
        >
          {listing.asset.qualityStatus === 'PASS'
            ? 'Quality checked'
            : listing.asset.qualityStatus === 'FAIL'
              ? 'Quality failed'
              : 'Quality pending'}
        </span>
        <span className="fa-chip">{isAuction ? 'Auction' : 'Fixed price'}</span>
      </div>

      {facts.length > 0 ? (
        <dl className="fa-listing-card__metrics">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd className="tabular">{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <footer className="fa-listing-card__foot">
        <span className="fa-muted">
          {listing.seller
            ? `${listing.seller.displayName} · ${listing.seller.tierCode}`
            : 'Unknown seller'}
        </span>
        {listing.seller && listing.seller.ratingCount > 0 ? (
          <span className="fa-muted tabular">
            {(listing.seller.ratingAvgBp / 100).toFixed(2)} ({listing.seller.ratingCount})
          </span>
        ) : (
          <span className="fa-muted">No reviews yet</span>
        )}
      </footer>
    </article>
  );
}
