# Full Run Receipt facts use a live companion feed

- Status: Accepted
- Date: 2026-08-30

A full Run Receipt view belongs to `dsh-legion-receipts`, a separate Host/Client companion. Standard DSH Web receives a complete Session-scoped baseline followed by complete replacements through official DSH Typert/Gateway while both the parent Session and companion instance remain live.

The companion writes no Receipt facts to storage, appends no custom Session event, and requires no DSH core change. Session disposal, companion reload, or Host restart ends full-fact availability, and a new companion instance starts empty. The companion has no execution authority; ordinary delegation continues when it is absent.

Remote child facts that official lifecycle and Session seams cannot prove are explicitly unavailable, while known aggregates may report partial coverage. The existing bounded tool summary remains the terminal artifact for headless and degraded use.
