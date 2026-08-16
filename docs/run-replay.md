# Run Replay

Build the package, then run dsh-legion replay --input session.jsonl --run <run-id> --json. Input is newline-delimited exported DSH Session events with contiguous sequence numbers. The command validates events, folds the legion-run projection, and renders a detached bounded inspection view.

## Capability requirements

Replay requires only the exported JSONL and the package. It starts no child, performs no mutation, and does not require Session persistence, projection registration, coordination, admission, credentials, or provider access. The projection key is legion-run and serialized state version is 5.

## Failure behavior

Malformed JSON, non-contiguous sequence numbers, unknown Legion envelope/data/record fields, invalid branded identities, and invariant violations fail loudly. Unrelated DSH events are accepted as projection no-ops. A checkpoint with the wrong state version is never trusted; replay refolds the supplied full history.

## Limits

Inspection output is bounded by the requested view limit and contains summaries, counts, digests, state, milestone decisions, and risk references rather than transcripts. Replay reads the finite supplied export; it does not discover Sessions or follow live files.

## Non-goals

Replay is not resume, repair, migration, journal rewriting, forensic transcript export, or proof that an external side effect occurred. It cannot create missing Host receipt evidence or make an old v1.0 consumer understand v1.1 event payloads.
