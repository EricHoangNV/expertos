import type { ReactNode } from "react";
import "@expertos/ui/ds.css";

export const metadata = {
  title: "ExpertOS",
  description: "AI-Powered. OPEX-Driven.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
