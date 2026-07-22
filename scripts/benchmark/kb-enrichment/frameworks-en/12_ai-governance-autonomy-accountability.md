# AI Governance: Autonomy, Accountability, and Ownership

As AI agents move from advising to acting — executing multi-step workflows across email, CRM, ERP,
and customer systems — the central question shifts from "can it?" to "how much autonomy should it
have, and who is accountable?". End-to-end automation is a governance decision, not just a technical
one.

## The autonomy ladder (graduated control)
AI autonomy is not all-or-nothing. Think of a ladder of increasing authority, each rung with more
control before you climb:
1. **Assist** — AI recommends; a human does the action.
2. **Human-approve** — AI proposes the action; a human approves each one before execution.
3. **Human-on-the-loop** — AI acts within tight bounds; a human monitors and can intervene/override.
4. **Bounded autonomy** — AI acts independently within an explicitly limited scope, value, and risk
   envelope, with exceptions escalated.
5. **Full autonomy** — AI acts end-to-end without routine human review (appropriate only for low-
   risk, reversible, well-bounded tasks).
Set the rung per decision by risk: reversibility, blast radius (financial, customer, legal),
data sensitivity, and confidence/error rate. Do not automate an entire process end-to-end just
because it is technically possible; match autonomy to risk, and raise it as evidence accrues.

## Eight dimensions for evaluating agentic autonomy
Before granting an agent autonomy over a workflow, assess: (1) reversibility of its actions, (2)
financial exposure per action, (3) customer/reputation impact, (4) legal/compliance exposure, (5)
data sensitivity and access scope, (6) model reliability/error rate on this task, (7) observability
(can you see and audit what it did?), and (8) the strength of guardrails and the ability to stop or
roll back. Low-risk on all eight → higher autonomy; high on any → keep a human in or on the loop.

## Error to control
Design for AI error, because it will occur. Put controls around the agent: input/output validation,
limits and rate caps, human checkpoints on high-impact steps, full logging and audit trails, and a
tested kill switch and rollback. The goal is that an AI error is caught and contained, not silently
executed across systems.

## Who owns AI transformation (federated accountability)
AI transformation crosses strategy, process, technology, data, people, risk, and economics — so it
cannot be owned by one role alone (not "the CAIO" or "IT"). Use a **federated accountability model**
with clear decision rights across separated concerns, for example:
- **Enterprise sponsorship** — the CEO owns strategy, prioritization, and value.
- **Transformation orchestration** — a leader/office coordinates the portfolio and change.
- **Technology & data** — CIO/CTO/CDO own platforms, integration, and data readiness.
- **Risk & compliance** — owns AI risk, controls, and governance (aligned to NIST AI RMF / ISO-IEC
  42001).
- **Business units** — own adoption, process redesign, and realized value in their domains.
One accountable owner per concern, with a governance body aligning them. Centralizing everything on a
single title stalls; leaving it to IT alone under-delivers business value.

## Governance frameworks to align to
Anchor AI governance in recognized frameworks — the **NIST AI Risk Management Framework** (Govern,
Map, Measure, Manage) and **ISO/IEC 42001** (AI management system) — so autonomy, risk controls, and
accountability are systematic rather than ad hoc.
