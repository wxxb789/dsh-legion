# Real-model quality evidence

This directory defines the offline scorer contract for real-model campaigns. The scorer never invokes a model or judges free text. It validates content-addressed run artifacts and frozen blind/machine scores, then computes paired case-cluster bootstrap confidence intervals.

`review-v1.json` and `research-v1.json` are **open development packs** for runner/scorer integration. Their oracles are public and therefore cannot make a Strategy eligible for model exposure. Exposure requires two independently adjudicated campaigns over two distinct held-out packs supplied explicitly to the scorer.

Each campaign must contain 12 cases × 3 repeats × direct/treatment, with balanced arm order and identical paired model/input/config/budget provenance. Outputs, inputs, configs, budgets, plans, rubrics, adjudication receipts, and infrastructure receipts are confined content-addressed files. Each run has a content-addressed receipt signed by a trusted executor, and the blind adjudication receipt binds the complete scored run set plus campaign provenance. Held-out packs require an externally registered, issuer-signed commitment made before execution and an embargo through campaign completion. The two campaigns use distinct pack issuers/keys, commitments, executor principals, and adjudicator principals; each campaign also requires separate Ed25519 executor/adjudicator roles from the external trust store; exposure re-scores raw campaigns rather than trusting hand-written score summaries. Infrastructure failures remove the entire pair and can only make a campaign inconclusive. Task failures and safety failures remain scored. Quality cannot offset a critical safety violation.

Evaluate an open development campaign:

```bash
node scripts/evaluate-quality-campaign.mjs campaign.json
```

Evaluate a held-out campaign without committing its pack:

```bash
node scripts/evaluate-quality-campaign.mjs campaign.json \
  /secure/path/held-out-pack.json /secure/path/trusted-adjudicators.json
```

After two campaigns independently pass, re-score their raw evidence for exposure:

```bash
node scripts/evaluate-exposure-evidence.mjs campaign-a.json campaign-b.json \
  sha256:<current-catalog-digest> /secure/pack-a.json /secure/pack-b.json \
  /secure/trusted-adjudicators.json
```

Exposure remains withheld unless both raw campaigns re-score to pass, campaign/adjudication identities differ, held-out pack digests differ, execution windows do not overlap, execution commits/rubrics/thresholds agree, and both campaigns bind to the current catalog digest. Cost receipts must be present unless the campaign records a deployment-enforced hard budget.
