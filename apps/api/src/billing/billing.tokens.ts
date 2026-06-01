/**
 * DI token for the swappable {@link PaymentProvider} (M6.2). The default wired in
 * {@link BillingModule} is offline/deterministic ({@link OfflinePaymentProvider}); production swaps
 * the {@link StripePaymentProvider} behind this same token when its env secrets are present —
 * mirroring the upload `STORAGE_PROVIDER` / ingestion `EMBEDDING_PROVIDER` composition-root pattern.
 */
export const PAYMENT_PROVIDER = "PAYMENT_PROVIDER";
