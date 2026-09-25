-- A failed CHECK aborts an entire D1 batch. Writers use a temporary guard row
-- to turn a stale lease or version conflict into an actual transaction abort;
-- a conditional UPDATE returning zero rows alone would still commit the batch.
CREATE TABLE transaction_guards (
  id TEXT PRIMARY KEY NOT NULL,
  valid INTEGER NOT NULL CHECK (valid = 1)
);
