import type { ReactNode } from "react";
import "@expertos/ui/ds.css";

export const metadata = {
  title: "ExpertOS · Admin",
  description: "ExpertOS administration & expert portal.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
