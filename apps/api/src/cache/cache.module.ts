import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ResponseCacheService } from "./response-cache.service";

/**
 * Wires the M6.4 caching layers (semantic → retrieval → answer). Exposes the single
 * {@link ResponseCacheService} choke point to its consumers — {@link RetrievalModule} (retrieval
 * cache) and {@link ChatModule} (answer + persistent semantic cache).
 *
 * `AuthModule` supplies {@link RlsService} (the persistent semantic cache runs inside the acting
 * user's RLS context); `StructuredLogger` comes from the global `ObservabilityModule`.
 */
@Module({
  imports: [AuthModule],
  providers: [ResponseCacheService],
  exports: [ResponseCacheService],
})
export class CacheModule {}
