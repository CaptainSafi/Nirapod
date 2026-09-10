-- 0010_accounts_and_dates.sql
-- Exact dates and written accounts, on Safi's decision (2026-09-09).
--
-- READ THIS BEFORE YOU READ 0003. That file says, in its opening comment, that
-- this table has no free text and no exact timestamp, and that the test for any
-- column is whether a full dump of the table identifies a submitter. This
-- migration deliberately relaxes two thirds of that rule, so the rule as stated
-- there is no longer the whole truth and this file is the amendment.
--
-- WHAT CHANGED, AND WHAT DID NOT.
--
--   occurred_on / occurred_time  the day and, optionally, the time. Collected
--                                because people remember days, not weeks.
--   account                      the reporter's own words, capped, REDACTED
--                                BEFORE INSERT by server/redact.js.
--
-- What did not change: publication. public_cells() and public_rollups() still
-- group by occurred_week and still suppress below threshold. A day plus a ward
-- plus a category is enough to pick out one person, so the day is collected and
-- is never published. Collect precise, publish coarse. If a future change
-- publishes occurred_on, every threshold in 0006 and 0008 stops meaning
-- anything, and that change belongs in the threat model before it belongs in
-- SQL.
--
-- What this costs, stated plainly so nobody has to rediscover it: a dump of
-- this table is now more dangerous than it was. Free text is the most
-- deanonymising field in any system like this, and redaction is a filter, not a
-- guarantee. It catches formats. It cannot catch "the SI at the outpost near my
-- shop". That is what the moderation state below is for.

BEGIN;

ALTER TABLE reports
  -- Nullable: the calendar is new, and rows written before it exist.
  ADD COLUMN occurred_on   date,
  ADD COLUMN occurred_time time,
  -- Only ever the redacted text. The original is never written anywhere: the
  -- phone number someone typed at 2am should not exist to be seized.
  ADD COLUMN account       text,
  -- none      no account was written
  -- held      written, not yet publishable (fails a filter, or awaiting the lag)
  -- published visible on the ward panel
  -- pulled    taken down, by a flag or by the owner. Kept, not deleted, so a
  --           takedown is auditable and cannot be silently reversed.
  ADD COLUMN account_state text NOT NULL DEFAULT 'none',
  ADD COLUMN account_flags integer NOT NULL DEFAULT 0,
  ADD COLUMN account_at    timestamptz;

ALTER TABLE reports
  ADD CONSTRAINT reports_account_len
    CHECK (account IS NULL OR char_length(account) <= 600),

  ADD CONSTRAINT reports_account_state
    CHECK (account_state IN ('none', 'held', 'published', 'pulled')),

  -- State and content cannot disagree. A row with no account cannot be in a
  -- moderation state, and a row with one cannot pretend it has none.
  ADD CONSTRAINT reports_account_state_matches
    CHECK ((account IS NULL AND account_state = 'none')
        OR (account IS NOT NULL AND account_state <> 'none')),

  ADD CONSTRAINT reports_account_flags_nonneg
    CHECK (account_flags >= 0),

  -- The day must fall inside the week the row claims. Without this the two
  -- columns can drift and the published week stops describing the stored day.
  -- date_trunc('week') is Monday-anchored in Postgres, which is what
  -- occurred_week already is.
  ADD CONSTRAINT reports_day_in_week
    CHECK (occurred_on IS NULL
           OR date_trunc('week', occurred_on)::date = occurred_week),

  ADD CONSTRAINT reports_day_not_future
    CHECK (occurred_on IS NULL OR occurred_on <= CURRENT_DATE),

  -- A time without a day is meaningless and would be a client bug.
  ADD CONSTRAINT reports_time_needs_day
    CHECK (occurred_time IS NULL OR occurred_on IS NOT NULL);

-- The moderation queue is "everything not yet decided, oldest first", and the
-- pull list is "everything published, newest first". Both are this index.
CREATE INDEX reports_account_state_idx
  ON reports (account_state, account_at DESC)
  WHERE account IS NOT NULL;

-- Account state changes are moderation decisions and need the same audit trail
-- as any other, but moderation_events.to_status is the report_status ENUM and a
-- takedown is not a report status. Its own table, rather than widening an enum
-- that means something specific.
CREATE TABLE account_events (
  id         bigserial PRIMARY KEY,
  report_id  uuid NOT NULL REFERENCES reports(id),
  moderator  text NOT NULL,
  from_state text NOT NULL,
  to_state   text NOT NULL,
  reason     text,
  acted_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_events_report_idx ON account_events (report_id);

-- The submit role writes an account; it must never be able to change one after
-- the fact, or read anyone else's.
GRANT SELECT, INSERT ON account_events TO nirapod_moderator;
GRANT USAGE ON SEQUENCE account_events_id_seq TO nirapod_moderator;

COMMIT;
