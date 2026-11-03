# Decisions (ADRs)

Exercised decisions that later work depends on. One file each: `NNNN-short-title.md`, numbered in merge order. An ADR refines [DESIGN.md](../DESIGN.md); if it would contradict the contract, it needs Brian's sign-off and a matching DESIGN edit in the same PR.

Write one when you pick between real alternatives (adapter, lock mechanism, renderer, schema shape, file format), not for incidental choices.

```markdown
# NNNN: Title

- Status: proposed | accepted | superseded by NNNN
- Task: P0-NN
- Evidence: ../../evidence/P0-NN/README.md

## Context
What forced a choice; constraints from DESIGN/BUILD_PLAN.

## Options considered
Each with what was actually exercised and what happened.

## Decision
The choice, and the platforms it is proven on.

## Consequences
What this commits us to; what would make us revisit.
```
