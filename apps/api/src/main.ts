import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { StructuredLogger } from "./observability/logger.service";
import { flushSentry, initSentry, reportException } from "./observability/sentry";

async function bootstrap(): Promise<void> {
  // Activate error tracking before anything else so bootstrap failures are captured
  // (no-op unless SENTRY_DSN is set).
  initSentry();

  // Buffer framework logs until the structured logger is wired so nothing is dropped
  // or printed in Nest's default (unstructured) format.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(StructuredLogger));
  app.enableShutdownHooks();

  // Cloud Run injects PORT (default 8080); fall back to API_PORT for local dev.
  const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3001);
  await app.listen(port, "0.0.0.0");
}

void bootstrap().catch(async (error) => {
  // Last-resort handler: surface bootstrap failures to Sentry, then exit non-zero.
  reportException(error);
  await flushSentry();
  process.exitCode = 1;
});
