import { Module } from '@nestjs/common';

import {
  BoundedHttpEvidenceReader,
  NodeDnsEvidenceReader,
} from '../../integrations/evidence/evidence-readers';
import { DNS_EVIDENCE_READER, HTTP_EVIDENCE_READER } from '../../common/tokens';
import { SellersModule } from '../sellers/sellers.module';
import { VerificationController } from './verification.controller';
import { VerificationRepository } from './verification.repository';
import { VerificationService } from './verification.service';

/**
 * Verification module. The live DNS/HTTP evidence readers perform real
 * network I/O (server-side, bounded, SSRF-guarded); e2e tests override the
 * tokens with deterministic stubs (see verification.e2e-spec.ts).
 */
@Module({
  imports: [SellersModule],
  controllers: [VerificationController],
  providers: [
    VerificationService,
    VerificationRepository,
    NodeDnsEvidenceReader,
    BoundedHttpEvidenceReader,
    { provide: DNS_EVIDENCE_READER, useExisting: NodeDnsEvidenceReader },
    { provide: HTTP_EVIDENCE_READER, useExisting: BoundedHttpEvidenceReader },
  ],
  exports: [VerificationService],
})
export class VerificationModule {}
