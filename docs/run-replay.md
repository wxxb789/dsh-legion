# Run Replay

Build the package, then run `dsh-legion replay --input session.jsonl --run <run-id> --json`. Input is newline-delimited exported DSH Session events with contiguous sequence numbers. Malformed JSON, unknown envelope/data/record fields, and invalid Legion payloads fail loudly. Unrelated DSH events are accepted as projection no-ops. Replay is pure inspection: it starts no child, performs no mutation, and does not require Host coordination. The projection key is `legion-run` and serialized state version is 5.
