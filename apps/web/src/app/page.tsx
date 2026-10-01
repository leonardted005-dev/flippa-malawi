import { ApiStatus } from '@/components/api-status';

export default function HomePage() {
  return (
    <main className="fa-container">
      <header
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Pan-African Digital Asset Marketplace</h1>
          <p className="fa-muted" style={{ margin: '4px 0 0' }}>
            Phase 1 · repository foundation. No marketplace features are implemented yet.
          </p>
        </div>
        <ApiStatus />
      </header>

      <section className="fa-card" style={{ marginTop: 24 }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Foundation status</h2>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>Monorepo: pnpm workspaces + Turborepo</li>
          <li>API: NestJS modular monolith with health endpoints and RFC 7807 errors</li>
          <li>
            Packages: <code>@fa/config</code>, <code>@fa/contracts</code>, <code>@fa/domain</code>
          </li>
          <li>Database: PostgreSQL via Prisma (schema bootstrap)</li>
          <li>
            Mobile: Flutter thin client (<code>apps/mobile</code>)
          </li>
        </ul>
      </section>

      <p className="fa-muted" style={{ marginTop: 16, fontSize: 13 }}>
        Marketplace experiences (browse, auctions, listings, escrow, admin) arrive in later phases —
        see
        <code> docs/IMPLEMENTATION_ROADMAP.md</code>.
      </p>
    </main>
  );
}
