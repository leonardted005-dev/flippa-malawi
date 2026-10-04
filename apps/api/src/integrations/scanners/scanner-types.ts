import { z } from 'zod';

export type { RawScanResult, ScannerKind, ScanTarget, SecurityScanner } from '@fa/domain';
export { SANDBOX_LIMITS } from '@fa/domain';

export const gitleaksOutputSchema = z.array(
  z.object({
    RuleID: z.string().optional().default('unknown-rule'),
    Description: z.string().optional().default(''),
    File: z.string().optional().default(''),
    StartLine: z.number().int().optional().default(1),
    Secret: z.string().optional().default(''),
    Match: z.string().optional().default(''),
    Fingerprint: z.string().optional().default(''),
  }),
);

export type GitleaksFinding = {
  RuleID: string;
  Description: string;
  File: string;
  StartLine: number;
  Secret: string;
  Match: string;
  Fingerprint: string;
};
