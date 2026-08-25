# Stair-step Advancement

Stair-step is an ordinary replaceable public Strategy advancement policy. Planner and verifier are normal Cohort member slots. Each accepted milestone binds a visible artifact, verification evidence, semantic progress, risks, a progress digest, and the next decision.

## Capability requirements

Policy materialization, PlanDelta expansion, and milestone evaluation are pure. Publishing a milestone or continuation uses the normal durable append path and therefore requires Session flush, projection registration, and Host coordination. No built-in Strategy name or private callback receives special authority.

## Failure behavior

Missing visible artifacts, unsatisfied verification criteria, untargeted retired risks, malformed bounds, and milestone overflow are rejected. Repeated semantic progress increments the no-progress streak. Configured authority expansion, irreversible effects, high-cost ambiguity, verification failure, or no progress can suspend the run. Checkpoint mode flushes the milestone, appends the one-shot continuation, flushes again, then yields.

## Limits

The public policy bounds milestone count and no-progress streak. Each milestone has bounded task and attempt budgets. Continuous mode still yields at activation limits; checkpoint mode yields after each accepted checkpoint. A continuation may only narrow authority and limits.

## Non-goals

Stair-step is not a hidden autonomous agent loop, a privileged default Strategy, a replacement for DSH Goals, or permission for model-authored code. It does not bypass PlanDelta validation, Host admission, fencing, or human approval policy.
