# Statistical Process Control: Variation, Signal vs Noise

Managing with data requires distinguishing real signals from normal variation. Reacting to
noise as if it were a signal ("tampering") makes performance worse.

## Common cause vs special cause variation
Every process varies. Statistical Process Control (SPC) separates two kinds:
- **Common cause (noise).** The inherent, routine variation of a stable process. It is the voice
  of the process. You cannot fix common-cause variation by chasing individual data points; you
  change it only by redesigning the process.
- **Special cause (signal).** Variation from a specific, assignable event outside the normal
  pattern. This is worth investigating and acting on.
A control chart is the tool that tells them apart: points within control limits and showing no
non-random patterns are common cause; points outside the limits or forming non-random patterns
are special cause.

## Average vs variation
Managing to the average hides risk. Two processes with the same mean can behave very
differently if one has wide variation. Customers and downstream steps feel the variation, not
the average. Always look at the spread and stability, not just the mean — a "good average" with
high variation is an unstable process waiting to fail.

## Stability before capability
Bring a process into statistical control (stable, only common-cause variation) **before** trying
to improve its capability (meeting specifications). Improving an out-of-control process produces
gains that do not hold, because the process is still being moved by special causes.

## Signal before action
Do not react to a single number. Ask whether the movement is a signal (special cause) or noise
(common cause). Overreacting to normal variation — adjusting the process after every bad data
point — injects more variation and degrades performance. Act on verified signals; change the
system to address common cause.

## Detect to prevent
The aim of measurement is not just to detect defects after the fact but to detect signals early
enough to prevent them. Move controls upstream (in-process checks, leading indicators, mistake-
proofing) so problems are caught and prevented rather than inspected out at the end.
