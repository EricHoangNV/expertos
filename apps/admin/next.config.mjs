import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@expertos/ui", "@expertos/shared"],
  // Cloud Run: emit a self-contained server (.next/standalone) so the Docker
  // image ships only traced deps. outputFileTracingRoot points at the repo root
  // so pnpm-workspace dependencies are traced correctly (§P0.4 deploy).
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
};

export default nextConfig;
