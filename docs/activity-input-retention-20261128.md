# Cycling integration: GPS control-I/O retention

Scope: Running/Cycling GPS adapters; no GPS filter, Auto Stop threshold, schema, or Running history migration changes.

## Input contract

- Copy the received batch before asynchronous control access. Preserve original callback time and app state.
- A process-local FIFO holds at most 128 batches / 1 MiB (UTF-16 JSON size estimate). Retry control admission/release every second. Before ticket creation, a 60-second budget bounds retries. Once a ticket might have reached Native, retain its receipt and retry until confirmed; after 60 seconds report CONTROL_UNCONFIRMED without forgetting a potentially durable lease. Capacity rejection, expiry, binding changes and unknown release are diagnostic outcomes, never saved-fix successes.
- Preserve known purpose, ID, start time, generation and database destination. A changed binding cancels the old input. A headless callback without a known binding must read the current owner; a session started after receipt cannot inherit that batch.
- Native generates a ticket before admission. Repeating `inputLease` with that ticket confirms the same durable lease, including an ACK lost after rename. Repeating `releaseInput` confirms the released state. These operations still use the checked file-sync / rename / directory-sync ownership writer.
- Run the observation callback once. A release failure retries release only. A callback exception is reported and released, never replayed as another observation; existing repository RAM/checkpoint recovery remains responsible for its SQL error.
- No unleased SQLite fallback. No raw GPS or route is included in retention logs.

## STOP boundary

STOP requests immediately close admission for that purpose. Earlier accepted FIFO entries drain before final freeze/save; subsequent callbacks are explicitly cancelled. A five-second wait timeout leaves ownership and queued inputs intact and asks for STOP retry. It never clears Native leases by timeout. An automatic goal retraction reopens admission for the same session; a new claim opens only its new binding.

## Limits and acceptance

This is bounded RAM retention, not a durable GPS journal. Process death can lose pending raw input; uncertain durable leases continue to block another START. No power-loss or headless-process continuity guarantee is inferred from Jest/Robolectric. Device background/Doze, syscall durability and real GPS/voice acceptance remain separate tests. Native control I/O is still included in measured callback latency and must be evaluated on the Test device.

Focused tests cover read/admission failure, FIFO, release ACK loss without duplicate observation, wrong purpose/generation/start, STOP drain/timeout/reopen, bounded capacity, expiry, SQL exception, and Native ticket acquire/release ACK loss. Integration and independent fixed-SHA review are required before release readiness.
