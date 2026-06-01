"use client";

import Link from "next/link";
import { Card } from "@expertos/ui";
import { AdminFrame } from "../src/components/AdminFrame";

/** Portal landing: jump into either review queue. */
export default function AdminHomePage() {
  return (
    <AdminFrame>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Admin &amp; Expert Portal</div>
          <h1 className="h1">Review queues</h1>
        </div>
      </div>
      <div className="row gap1">
        <Link href="/knowledge">
          <Card className="card-pad">
            <h3 className="h3">Knowledge</h3>
            <p className="muted">
              Review and publish versioned knowledge documents through the expert-review gate.
            </p>
          </Card>
        </Link>
        <Link href="/knowledge-drafts">
          <Card className="card-pad">
            <h3 className="h3">Drafts</h3>
            <p className="muted">
              Review valuable answers captured from conversations and publish them to the
              knowledge base.
            </p>
          </Card>
        </Link>
      </div>
    </AdminFrame>
  );
}
