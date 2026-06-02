import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../../../.env") });

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
  // or printed in Nest's default (unstructured) format. `rawBody` preserves the unparsed
  // request bytes on `req.rawBody` so the billing webhook can verify the provider signature
  // over exactly what was sent (a JSON re-encode would invalidate the HMAC).
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });
  app.useLogger(app.get(StructuredLogger));
  app.enableShutdownHooks();

  // The web + admin clients are deployed as separate origins from the API (distinct Cloud Run
  // services), so the browser sends cross-origin requests with a CORS preflight. Allow the
  // configured origins (comma-separated `CORS_ORIGINS`); default to the local dev/E2E origins
  // so a same-host run works out of the box (production must set the real client URLs). Auth is
  // a bearer ID token, not a cookie, so credentials are intentionally not enabled.
  const corsOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:3000,http://localhost:3002")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigins,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
    maxAge: 600,
  });

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
