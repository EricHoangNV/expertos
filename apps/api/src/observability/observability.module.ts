import {
  type MiddlewareConsumer,
  Global,
  Module,
  type NestModule,
} from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { AuthModule } from "../auth/auth.module";
import { AllExceptionsFilter } from "./all-exceptions.filter";
import { StructuredLogger } from "./logger.service";
import { RequestContextMiddleware } from "./request-context.middleware";
import { UsageLogService } from "./usage-log.service";

/**
 * Cross-cutting observability baseline (PRD Phase 0 §5): structured logging, request
 * tracing (correlation id + Cloud Trace), a catch-all error filter that reports to Sentry,
 * and the cost/usage logger. Global so any feature module gets {@link StructuredLogger} and
 * {@link UsageLogService} without re-importing.
 *
 * `StructuredLogger` is registered via a factory (not class introspection) because its
 * constructor takes an optional log sink, which Nest's DI can't and shouldn't resolve.
 */
@Global()
@Module({
  imports: [AuthModule],
  providers: [
    { provide: StructuredLogger, useFactory: () => new StructuredLogger() },
    UsageLogService,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
  exports: [StructuredLogger, UsageLogService],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes("*");
  }
}
