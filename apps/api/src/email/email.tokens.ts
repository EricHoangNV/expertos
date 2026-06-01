/**
 * DI token for the transactional-email driver (M9.3). Injected so the {@link EmailService} choke point
 * is provider-agnostic and trivially unit-testable with a fake. Resolved by
 * {@link createDefaultEmailProvider} — the real {@link HttpEmailProvider} when its env config is
 * present, else the {@link OfflineEmailProvider}.
 */
export const EMAIL_PROVIDER = "EMAIL_PROVIDER";
