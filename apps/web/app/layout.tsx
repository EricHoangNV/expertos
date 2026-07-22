import type { ReactNode } from "react";
import "@expertos/ui/ds.css";
import { AuthProvider } from "../src/lib/auth-context";
import { BetaGateBoundary } from "../src/components/beta-gate";
import { LocaleProvider } from "../src/lib/i18n";

export const metadata = {
  title: "ExpertOS",
  description: "AI-Powered. OPEX-Driven.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <LocaleProvider>
            <BetaGateBoundary>{children}</BetaGateBoundary>
          </LocaleProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
