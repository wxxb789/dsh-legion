# Legion Orchestration

Legion lets a coordinator delegate one objective through user-defined worker capabilities, cohort shapes, and bounded orchestration policies while DeepSeek Harness owns execution lifecycle and authority.

## Language

**Config Document**:
A versioned authored description of Specialists and deployment policy that can be normalized or exported for a compatible rollback target.
_Avoid_: Effective Catalog, Runtime state

**Specialist**:
A reusable worker capability template describing task fit, model-routing requirements, prompt behavior, visible capabilities, and result contract.
_Avoid_: Profile, Agent preset, Persona, Agent, Worker instance, Role preset

**Route Candidate**:
One exact provider/model choice in a Specialist's priority-ordered pre-start policy, with optional static constraints and additive instructions.
_Avoid_: Runtime fallback, Retry target, Model class

**Route Plan**:
An immutable, evidence-bearing decision that selects at most one Route Candidate before a child starts and records every known rejection, unknown, and skipped lower-priority candidate.
_Avoid_: Retry plan, Availability check, Model leaderboard

**Prompt Fragment**:
A bounded, deployment-authorized text resource that adds Specialist-specific system instructions without becoming a user task or a Skill.
_Avoid_: Skill, Prompt template, Arbitrary file

**Resource Root**:
A deployment-owned directory alias that bounds where Prompt Fragments may be loaded from.
_Avoid_: Search path, Workspace access, Filesystem permission

**Cohort**:
A named composition of member slots available to one orchestration strategy. It is authored and compiled, never live: it names positions, not participants.
_Avoid_: Team, Roster, Agent list, Fleet, Runtime

**Member Slot**:
A named position in a Cohort that references a Specialist and may declare multiplicity or participation constraints; it is not a live child.
_Avoid_: Team member, Teammate, Agent, Process, Session

**Strategy**:
A bounded policy that turns an Objective and Cohort into orchestration decisions, artifact handoffs, completion rules, and limits.
_Avoid_: Workflow runtime, Scheduler, Prompt

**Artifact**:
A named, versioned Strategy value with an explicit contract, cardinality, and availability; it is never a live Agent, Session, or transcript.
_Avoid_: Tool result object, Shared mutable state, Runtime handle

**Compiled Strategy Plan**:
An immutable objective-bound graph of DSH primitive IR, artifacts, completion, and narrowed hard limits.
_Avoid_: Cohort Run, WorkflowRun, Scheduler state

**Cohort Run**:
One execution of a Strategy against an Objective and Cohort, with one stable Cohort Run identity plus the native DSH runs and artifacts it invokes.
_Avoid_: Team, Agent Team, Mission database

**Objective**:
The user-owned outcome a Cohort Run is intended to achieve.
_Avoid_: Prompt, Task message

**Run Receipt**:
The durable, structured account of one Cohort Run — its stages, children, live participation, consumed tokens, elapsed time, and outcome — derived from Host-owned facts rather than from what a model reported about itself. It accounts in tokens and time, never in money.
_Avoid_: Transcript, Log line, Progress narration, Telemetry event, Invoice

**Endorsement**:
The evidence-derived standing of a catalog entry, distinguishing what a deployment may run from what Legion is willing to recommend.
_Avoid_: Availability, Enablement, Registration, Benchmark score

**Delegation Row**:
A composed Legion row that publishes the model-facing delegation tool and its coordinator prompt section into the layer it was mounted in, and reads the settings namespace it does not own.
_Avoid_: Agent-plane plugin, Tool registration, Session

**Settings Row**:
The Host-plane Legion row that owns the process-wide settings namespace and the Web card and contributes nothing else — no tool, no prompt section, no projection, no service.
_Avoid_: Global Legion mount, Config service, Second configuration source

**Default Catalog**:
Legion's curated Specialists, Cohorts, and Strategies, distributed as ordinary replaceable configuration under the same contracts available to users.
_Avoid_: Built-in special cases, Hardcoded cohort

**Effective Catalog**:
The validated, normalized view of user and default catalog entries that are available for orchestration.
_Avoid_: Raw config, Registry dump

**Model Strategy Exposure**:
Deployment-owned authority allowing the model-facing Legion tool to invoke active Strategies; catalog presence or programmatic execution alone does not grant it.
_Avoid_: Strategy registration, Benchmark result, Default enablement

**Durable Strategy Run**:
An explicitly enabled execution of a Strategy whose durable orchestration history is anchored to one invoking DSH Session and reconstructed from typed Session events.
_Avoid_: Workflow runtime, Global job, Independent persistence record

**Durable Strategy Controller**:
The bounded, Session-anchored interpreter that advances one Durable Strategy Run from its projected journal state while DSH owns persistence and child execution.
_Avoid_: Scheduler service, Workflow engine, Process-global runtime

**Plan Graph**:
One immutable, versioned DAG describing the current typed tasks, dependencies, artifacts, and limits of a Durable Strategy Run.
_Avoid_: Mutable task list, Scheduler state, JavaScript program

**Plan Delta**:
A structured, validated, version-CAS proposal that monotonically evolves pending work in a Plan Graph without rewriting committed history or widening authority.
_Avoid_: Prompt instruction, Callback, In-place graph mutation

**Run Lease**:
A Host-issued, time-bounded claim carrying a monotonically increasing fence that authorizes one controller activation to advance a Durable Strategy Run.
_Avoid_: Journal owner field, Process mutex, Session lock file

**Fence**:
A monotonically increasing Host coordination token used with task generations to reject stale reservations, continuations, and results.
_Avoid_: Timestamp, Owner fingerprint, Retry count

**Durable Mailbox**:
A task-addressed delivery protocol whose queued, reserved, incorporated, acknowledged, and discarded post-states exist only as typed events in the anchor Session journal; reclaiming an expired reservation returns it to queued state with an incremented reclaim count.
_Avoid_: Agent chat, Queue service, Mailbox directory

**Context Manifest**:
An immutable, ordered, digest-addressed selection of context pages for one task generation, with a cache-stable shared prefix and explicit trust, freshness, and lineage.
_Avoid_: Transcript copy, Mutable prompt buffer, Context store

**Milestone**:
A visible, verified, risk-retiring increment recorded with its artifacts, evidence, and next decision.
_Avoid_: Tool call count, Time slice, Unverified progress report

**Stair-step**:
A public replaceable advancement policy that repeatedly commits the smallest visible, verifiable increment that retires meaningful uncertainty or risk.
_Avoid_: Privileged built-in strategy, Random small edits, Giant upfront plan

**Continuation**:
A bounded, immutable, one-shot datum that identifies a durable semantic resume boundary without capturing executable process state.
_Avoid_: JavaScript closure, VM stack, Multi-shot call/cc

**Host Coordination**:
Host-owned atomic lease and fence authority that excludes concurrent Durable Strategy Run owners.
_Avoid_: Legion lock service, Journal-only claim, Process-local mutex

**Host Admission**:
Host-owned global resource reservation and backpressure authority across Sessions and Strategy Runs.
_Avoid_: Per-run concurrency limit, Provider health guess, Legion scheduler
