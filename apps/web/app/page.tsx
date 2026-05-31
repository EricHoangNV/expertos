import { Badge, Button } from "@expertos/ui";

export default function HomePage() {
  return (
    <main className="card card-pad">
      <h1>ExpertOS</h1>
      <p>AI-Powered. OPEX-Driven.</p>
      <Badge tone="green">scaffold ready</Badge>
      <Button variant="primary">Get started</Button>
    </main>
  );
}
