# Curated Strategy exposure requires two tiers of evidence

- Status: Accepted
- Date: 2026-08-15

Every change runs a deterministic scripted protocol gate that proves orchestration invariants, artifact aggregation, bounded child starts, and terminal outcomes. That gate is explicitly not model-quality evidence. Curated Strategies remain absent from the model-facing tool until each Strategy also has two independently adjudicated paired real-model campaigns over distinct held-out packs, with positive case-cluster bootstrap quality/evidence bounds, no critical safety violation, acceptable win/loss rates, cost and latency guardrails, and current catalog/execution provenance.

The offline scorer never invokes or judges a model. It validates confined content-addressed campaign artifacts, balanced direct/treatment pairing, receipts, and provenance, then applies preregistered thresholds. Held-out scores are bound to every run by an Ed25519-signed blind-adjudication receipt from an external trust store. Infrastructure failures remove the entire pair and can only produce `inconclusive`; task/safety failures remain in the denominator. Open development packs are packaged for scorer integration but are ineligible for exposure because their oracles are public. Exposure always re-scores two raw content-addressed campaigns rather than trusting score summaries. It requires both to pass, distinct campaign/adjudication receipts and held-out pack digests, non-overlapping execution windows, matching execution commits/rubrics/thresholds, and the current catalog digest.
