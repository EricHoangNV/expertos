/**
 * DI token for the swappable {@link TidyCalProvider} (M7.3). The default wired in
 * {@link ConsultationModule} is offline/deterministic ({@link OfflineTidyCalProvider}); production
 * swaps the {@link HttpTidyCalProvider} behind this same token when its webhook secret is present —
 * mirroring the billing `PAYMENT_PROVIDER` / upload `STORAGE_PROVIDER` composition-root pattern.
 */
export const TIDYCAL_PROVIDER = "TIDYCAL_PROVIDER";
