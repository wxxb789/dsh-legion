# Protocol benchmark

This deterministic benchmark is a regression gate for Legion's orchestration semantics, not a claim about general model quality. A scripted provider supplies fixed responses for three tasks:

1. direct implementation versus independent execution + review;
2. one direct research result versus a three-member panel + synthesis;
3. one direct execution versus bounded plan + execute + review + repair.

The structural score measures expected defect and source markers encoded by those fixtures. The gate proves that the protocols preserve and aggregate evidence while keeping a declared bound on child starts. It does not estimate credentials, provider health, real token price, or performance on unseen tasks.

Run after building:

```bash
pnpm run build
pnpm run benchmark:protocol
```

Thresholds are versioned in `protocol-thresholds.json`. Changing fixtures or thresholds requires review because it changes protocol evidence.

Real-model evidence uses a separate offline campaign scorer under [`quality/`](quality/README.md). Open development packs verify scorer integration but cannot enable model exposure; two distinct held-out campaigns are required.
