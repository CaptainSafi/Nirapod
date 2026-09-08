-- Discard proof-of-work receipts after 30 days (spec §2.1).
-- Schedule daily. A nonce is not an identifier, but it is a value we have no
-- further use for, and data we do not hold cannot be demanded from us.
UPDATE reports
   SET pow_nonce = NULL
 WHERE pow_nonce IS NOT NULL
   AND submitted_day < CURRENT_DATE - INTERVAL '30 days';
