# Batch Economics and Total System Cost

Many "cost saving" decisions optimize one visible number while raising hidden costs elsewhere in
the system. The discipline is to evaluate the **total system cost**, not the local unit cost.

## The batch-economics trap
Consolidating work into larger batches (waiting to fill a truck or container, running longer
production runs, batching orders) lowers an obvious per-unit cost — freight per unit, setup per
unit. But larger batches raise costs that do not appear on the same line item:
- **Lead time and responsiveness** get worse (things wait for the batch to fill).
- **Inventory and working capital** rise (more held, longer).
- **Variability amplification** — big infrequent batches create lumpy demand upstream (bullwhip).
- **Quality risk** — defects hide in large batches and are caught late, so more is scrapped/reworked.
- **Obsolescence and flexibility loss** — committed batches cannot adapt to demand changes.
Before consolidating, evaluate the full trade: freight/setup saving vs the added inventory,
lead-time, quality-risk, and flexibility cost. Often the "obvious" consolidation is a net loss once
the hidden costs are counted. The answer is rarely a blanket "always consolidate" or "never" — it
depends on demand variability, holding cost, and changeover cost.

## Reducing changeover unlocks small batches
If small batches are desirable (for flow and responsiveness) but changeover/setup is expensive,
the leverage is to **reduce changeover cost** (SMED) rather than accept large batches. Cheaper
changeover shifts the economic batch size down and lets flow improve without a cost penalty.

## Purchase price vs total cost of ownership
The lowest purchase price is frequently the highest total cost. Evaluate sourcing and equipment
decisions on **total system cost**: price plus quality/defect cost, logistics and inventory,
reliability and downtime, rework, switching and coordination cost, and risk. A cheaper unit that
raises defects, downtime, or freight, or that forces larger buffers, costs the system more than a
higher-priced, better-fitting alternative.

## Freight and consolidation, specifically
For "should we consolidate shipments and wait for a full truck?": compute the freight-per-unit
saving against the cost of the added transit/wait time, the extra inventory held on both ends, the
service-level impact, and demand variability. Consolidate where demand is stable and holding cost
is low; keep smaller, more frequent shipments where responsiveness and low inventory matter more
than freight rate.

## The rule
Optimize the system's total cost and value, not a local unit cost. Any local optimization should be
checked for the costs it pushes elsewhere before it is adopted.
