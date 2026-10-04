/**
 * Evidence-source ports owned by the domain. Adapters perform the live
 * network reads; the domain never touches DNS or HTTP directly.
 *
 * Each adapter returns OBSERVED facts (records/pages), and the SERVICE makes
 * the match decision server-side against the stored challenge hash.
 * Client claims are never trusted.
 */

export interface DnsTxtRecord {
  name: string;
  values: string[];
}

export interface DnsEvidenceReader {
  /** Live TXT lookup for a fully-qualified record name. Never cached across checks. */
  txtRecords(fqdn: string): Promise<DnsTxtRecord[]>;
}

export interface HttpEvidenceReader {
  /** Fetches a well-known verification path. Follows NO redirects to private hosts. */
  fetchText(url: string): Promise<{ status: number; body: string }>;
}

/** Provider snapshot for social/store ownership proofs (Phase 8: manual + stub). */
export interface SocialSnapshotReader {
  fetchSnapshot(provider: string, subjectRef: string): Promise<{ raw: unknown; sha256: string }>;
}
