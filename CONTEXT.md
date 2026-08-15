# Legion Orchestration

Legion lets a coordinator delegate one objective through user-defined worker capabilities, team shapes, and bounded orchestration policies while DeepSeek Harness owns execution lifecycle and authority.

## Language

**Config Document**:
A versioned authored description of Profiles and deployment policy that can be normalized or exported for a compatible rollback target.
_Avoid_: Effective Catalog, Runtime state

**Profile**:
A reusable worker capability template describing task fit, model-routing requirements, prompt behavior, visible capabilities, and result contract.
_Avoid_: Agent, Worker instance, Role preset

**Route Candidate**:
One exact provider/model choice in a Profile's priority-ordered pre-start policy, with optional static constraints and additive instructions.
_Avoid_: Runtime fallback, Retry target, Model class

**Route Plan**:
An immutable, evidence-bearing decision that selects at most one Route Candidate before a child starts and records every known rejection, unknown, and skipped lower-priority candidate.
_Avoid_: Retry plan, Availability check, Model leaderboard

**Prompt Fragment**:
A bounded, deployment-authorized text resource that adds Profile-specific system instructions without becoming a user task or a Skill.
_Avoid_: Skill, Prompt template, Arbitrary file

**Resource Root**:
A deployment-owned directory alias that bounds where Prompt Fragments may be loaded from.
_Avoid_: Search path, Workspace access, Filesystem permission

**Team**:
A named composition of member slots available to one orchestration strategy.
_Avoid_: Agent list, Fleet, Runtime

**Member Slot**:
A named position in a Team that references a Profile and may declare multiplicity or participation constraints; it is not a live child.
_Avoid_: Agent, Process, Session

**Strategy**:
A bounded policy that turns an Objective and Team into orchestration decisions, artifact handoffs, completion rules, and limits.
_Avoid_: Workflow runtime, Scheduler, Prompt

**Artifact**:
A named, versioned Strategy value with an explicit contract, cardinality, and availability; it is never a live Agent, Session, or transcript.
_Avoid_: Tool result object, Shared mutable state, Runtime handle

**Compiled Strategy Plan**:
An immutable objective-bound graph of DSH primitive IR, artifacts, completion, and narrowed hard limits.
_Avoid_: Team Run, WorkflowRun, Scheduler state

**Team Run**:
One execution of a Strategy against an Objective and Team, identified by the native DSH runs and artifacts it invokes.
_Avoid_: Team, Mission database

**Objective**:
The user-owned outcome a Team Run is intended to achieve.
_Avoid_: Prompt, Task message

**Default Catalog**:
Legion's curated Profiles, Teams, and Strategies, distributed as ordinary replaceable configuration under the same contracts available to users.
_Avoid_: Built-in special cases, Hardcoded team

**Effective Catalog**:
The validated, normalized view of user and default catalog entries that are available for orchestration.
_Avoid_: Raw config, Registry dump

**Model Strategy Exposure**:
Deployment-owned authority allowing the model-facing Legion tool to invoke active Strategies; catalog presence or programmatic execution alone does not grant it.
_Avoid_: Strategy registration, Benchmark result, Default enablement
