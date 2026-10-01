// Unit-test defaults only. E2E tests use apps/api/test/.env.test instead.
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://fa:fa@localhost:5432/flippa_africa?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-0123456789';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-0123456789';
process.env.FIELD_ENCRYPTION_KEY ??= 'test-field-encryption-key-0123456789';
process.env.STORAGE_ENDPOINT ??= 'http://localhost:9000';
process.env.STORAGE_BUCKET ??= 'fa-test';
process.env.STORAGE_ACCESS_KEY_ID ??= 'test-access-key';
process.env.STORAGE_SECRET_ACCESS_KEY ??= 'test-secret-key';
