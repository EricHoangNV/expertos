# Root Cause Analysis and the Discipline of Verification

Finding a plausible cause is not the same as finding the root cause. The most common failure in
problem solving is accepting the first plausible answer and acting on it before it is verified
with evidence.

## 5-Why and its traps
5-Why asks "why?" repeatedly to move from symptom to root cause. It is useful but easily
misused:
- **Single-path trap.** Real problems usually have several contributing causes. A single chain
  of whys often stops at one convenient cause (frequently "lack of training") and misses others.
- **Opinion trap.** Each "why" must be supported by evidence, not assumption. An unverified 5-Why
  is just a chain of guesses.
- **Blame trap.** Whys that end at a person ("operator was careless") usually mask a system cause
  (interface design, unclear standard, process complexity).

## "Lack of training" is rarely the whole root cause
When 5-Why lands on "lack of training," treat it as a hypothesis, not a conclusion. Before
committing to training as the fix, verify:
- **Evidence.** Do the data show the errors concentrate among untrained people, or are trained
  people erring too? Segment the data.
- **Alternative causes.** Could interface/design, unclear standards, process complexity,
  tooling, or workload be driving the errors? Training will not fix a badly designed process.
- **Sustainability.** Even if training helps, without a standard and a control it will decay.
Only after verification should you implement, and then confirm the fix with data and standardize
it (the Control step).

## Correlation is not causation
A strong statistical relationship between two variables does not prove one causes the other.
Before concluding "X causes Y" and acting:
- **Check for confounders.** A third factor may drive both (for example, seasonal demand raising
  both overtime and defects).
- **Consider reverse causation and coincidence.** Y might cause X, or the link may be spurious.
- **Sequence the analysis.** Establish the relationship, form a causal hypothesis, test it (ideally
  by controlled change or by ruling out confounders), and only then act.
Acting on correlation alone — for example, cutting overtime to reduce defects when both are
driven by a demand spike or an upstream process problem — wastes effort and can make things
worse.

## The rule
Evidence before action. Verify the root cause, consider multiple and systemic causes, rule out
confounding, and confirm the fix held. Diagnosis rigor is what separates a solved problem from a
recurring one.
