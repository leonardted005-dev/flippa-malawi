import { PrismaClient, type AssetType } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Idempotent seed (safe to run repeatedly — upsert by natural key).
 * No marketplace business data is seeded in Phase 1; only framework defaults.
 */
async function main(): Promise<void> {
  const settings: { key: string; value: unknown }[] = [
    { key: 'platform.currency.default', value: { currency: 'ZMW' } },
    { key: 'platform.countries.anchor', value: { country: 'ZM' } },
    { key: 'payments.defaultProvider', value: { provider: 'dpo' } },
  ];

  for (const setting of settings) {
    await prisma.systemSetting.upsert({
      where: { key: setting.key },
      update: {},
      create: { key: setting.key, value: setting.value as object },
    });
  }

  console.log(`[seed] upserted ${settings.length} system settings (idempotent).`);

  const tiers = [
    {
      code: 'FREE_CODER',
      name: 'Free Coder',
      storageQuotaBytes: 50n * 1024n * 1024n,
      maxUploadBytesPerFile: 50n * 1024n * 1024n,
      maxActiveListings: 3,
      commissionBps: 1500,
      qualityQueue: 'standard',
      verificationLevel: 'basic',
      features: {},
    },
    {
      code: 'PRO_CODER',
      name: 'Pro Coder',
      storageQuotaBytes: 2n * 1024n * 1024n * 1024n,
      maxUploadBytesPerFile: 512n * 1024n * 1024n,
      maxActiveListings: 25,
      commissionBps: 1000,
      qualityQueue: 'priority',
      verificationLevel: 'enhanced',
      features: { customBranding: true },
    },
    {
      code: 'CORPORATE_SELLER',
      name: 'Corporate Seller',
      storageQuotaBytes: null,
      maxUploadBytesPerFile: 2n * 1024n * 1024n * 1024n,
      maxActiveListings: null,
      commissionBps: 700,
      qualityQueue: 'priority',
      verificationLevel: 'enterprise',
      features: { customBranding: true, apiAccess: true },
    },
  ];

  for (const tier of tiers) {
    await prisma.sellerTier.upsert({
      where: { code: tier.code },
      update: {
        name: tier.name,
        storageQuotaBytes: tier.storageQuotaBytes,
        maxUploadBytesPerFile: tier.maxUploadBytesPerFile,
        maxActiveListings: tier.maxActiveListings,
        commissionBps: tier.commissionBps,
        qualityQueue: tier.qualityQueue,
        verificationLevel: tier.verificationLevel,
        features: tier.features,
      },
      create: {
        code: tier.code,
        name: tier.name,
        storageQuotaBytes: tier.storageQuotaBytes,
        maxUploadBytesPerFile: tier.maxUploadBytesPerFile,
        maxActiveListings: tier.maxActiveListings,
        commissionBps: tier.commissionBps,
        qualityQueue: tier.qualityQueue,
        verificationLevel: tier.verificationLevel,
        features: tier.features,
      },
    });
  }

  console.log(`[seed] upserted ${tiers.length} seller tiers (placeholder commercial values).`);

  const rootCategories = [
    {
      slug: 'software-and-code',
      name: 'Software & Code',
      assetTypes: ['SOFTWARE', 'MOBILE_APP'],
      sort: 10,
    },
    { slug: 'websites', name: 'Websites', assetTypes: ['WEBSITE'], sort: 20 },
    { slug: 'domains', name: 'Domains', assetTypes: ['DOMAIN'], sort: 30 },
    {
      slug: 'social-and-audience',
      name: 'Social & Audience',
      assetTypes: ['YOUTUBE_CHANNEL', 'INSTAGRAM_PROFILE'],
      sort: 40,
    },
    { slug: 'gaming', name: 'Gaming', assetTypes: ['GAME_ACCOUNT'], sort: 50 },
    { slug: 'other-digital-assets', name: 'Other Digital Assets', assetTypes: ['OTHER'], sort: 90 },
  ] as const;

  const childCategories = [
    {
      slug: 'saas-applications',
      name: 'SaaS Applications',
      parent: 'software-and-code',
      assetTypes: ['SOFTWARE'],
      sort: 11,
    },
    {
      slug: 'developer-tools',
      name: 'Developer Tools',
      parent: 'software-and-code',
      assetTypes: ['SOFTWARE'],
      sort: 12,
    },
    {
      slug: 'mobile-apps',
      name: 'Mobile Apps',
      parent: 'software-and-code',
      assetTypes: ['MOBILE_APP'],
      sort: 13,
    },
    {
      slug: 'ecommerce-websites',
      name: 'E-commerce Websites',
      parent: 'websites',
      assetTypes: ['WEBSITE'],
      sort: 21,
    },
    {
      slug: 'content-websites',
      name: 'Content & Blogs',
      parent: 'websites',
      assetTypes: ['WEBSITE'],
      sort: 22,
    },
    {
      slug: 'premium-domains',
      name: 'Premium Domains',
      parent: 'domains',
      assetTypes: ['DOMAIN'],
      sort: 31,
    },
    {
      slug: 'youtube-channels',
      name: 'YouTube Channels',
      parent: 'social-and-audience',
      assetTypes: ['YOUTUBE_CHANNEL'],
      sort: 41,
    },
    {
      slug: 'instagram-profiles',
      name: 'Instagram Profiles',
      parent: 'social-and-audience',
      assetTypes: ['INSTAGRAM_PROFILE'],
      sort: 42,
    },
    {
      slug: 'game-accounts',
      name: 'Game Accounts',
      parent: 'gaming',
      assetTypes: ['GAME_ACCOUNT'],
      sort: 51,
    },
    {
      slug: 'general-digital-assets',
      name: 'General',
      parent: 'other-digital-assets',
      assetTypes: ['OTHER'],
      sort: 91,
    },
  ] as const;

  for (const category of rootCategories) {
    const assetTypes = [...category.assetTypes] as AssetType[];
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: { name: category.name, assetTypes, sort: category.sort },
      create: { slug: category.slug, name: category.name, assetTypes, sort: category.sort },
    });
  }

  const roots = await prisma.category.findMany({
    where: { slug: { in: rootCategories.map((category) => category.slug as string) } },
  });
  const rootIdBySlug = new Map(roots.map((category) => [category.slug, category.id]));

  for (const category of childCategories) {
    const assetTypes = [...category.assetTypes] as AssetType[];
    const parentId = rootIdBySlug.get(category.parent) ?? null;
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: { name: category.name, assetTypes, sort: category.sort, parentId },
      create: {
        slug: category.slug,
        name: category.name,
        assetTypes,
        sort: category.sort,
        parentId,
      },
    });
  }

  console.log(
    `[seed] upserted ${rootCategories.length + childCategories.length} categories (roots + children).`,
  );
}

main()
  .catch((error: unknown) => {
    console.error('[seed] failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
