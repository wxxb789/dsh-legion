# Doctor explains explicit fixtures, not live provider health

- Status: Accepted
- Date: 2026-08-15

`dsh-legion doctor` and `explain` compile a standalone Legion config against an explicit versioned provider-capability fixture and project the canonical `CompiledCatalog` into a JSON-safe `legion-explain` view. They do not attach to a live DSH process or infer credentials, network reachability, quota, billing, latency, model availability, or provider health. Missing fixture entries remain warnings and `unknown` evidence rather than false failures or false reassurance; live health requires a future redacted DSH-owned seam.

The CLI returns 0 for a generated view without error-severity diagnostics, 1 for a generated view with capability errors, and 2 for usage, I/O, parsing, or runtime-schema failures. Human and JSON renderers consume the same versioned explain view and contain no separate eligibility rules.
