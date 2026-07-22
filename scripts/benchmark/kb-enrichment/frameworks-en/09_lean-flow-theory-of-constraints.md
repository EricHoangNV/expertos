# Lean, Flow, and the Theory of Constraints

Operational performance is governed by how value flows end to end, not by how busy each resource
is. Optimizing local speed or utilization usually degrades the whole.

## Flow before speed; flow over utilization
- **Flow before speed.** The objective is smooth, fast end-to-end flow of value to the customer,
  not maximum speed at any single step. Speeding up one station ahead of the constraint just builds
  inventory in front of the next bottleneck.
- **Flow over utilization.** Driving every resource to high utilization creates queues. Queueing
  theory (and Little's Law) shows that as utilization approaches 100%, wait time and work-in-
  process explode. Deliberate slack at non-constraints is what lets value flow. High utilization is
  not the same as high throughput.

## Little's Law
Work-in-process = throughput × lead time. To cut lead time, cut WIP (limit how much is in the
system at once) rather than pushing more work in. Less WIP means faster, more predictable flow.

## Theory of Constraints (TOC)
Every system has a constraint (bottleneck) that limits total throughput. The five focusing steps:
1. **Identify** the constraint.
2. **Exploit** it — get the most from it (never let it starve or idle).
3. **Subordinate** everything else to the constraint's pace — do not run non-constraints faster
   than the constraint can absorb.
4. **Elevate** the constraint (add capacity) only if steps 1–3 are not enough.
5. **Repeat** — the constraint moves; do not let inertia set in.
Improving a non-constraint does nothing for throughput; it only adds cost and inventory. Focus
improvement on the constraint.

## Batch to flow
Large batches create waiting, hide defects, and lengthen lead time. Moving toward smaller batches
and one-piece flow (where feasible) shortens lead time, surfaces problems faster, and reduces
inventory — provided changeover cost is addressed (see batch economics). Batch size is a design
choice with system-wide consequences, not a local convenience.

## Inventory as signal and buffer
Inventory is both a **buffer** (protecting against variation and decoupling steps) and a
**signal** (its accumulation reveals where flow is broken). Do not blanket-cut inventory; place
buffers deliberately where variation must be absorbed (for example at the decoupling point that
separates forecast-driven from demand-driven activity), and read rising inventory as a signal of an
upstream flow problem to fix at the root.
