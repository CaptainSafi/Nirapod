-- 0013_submit_reference_grants.sql
-- Let the submit role read the taxonomy tables its own CHECK constraints use.
--
-- reports has CHECK constraints that call subcategory_matches_category(),
-- category_requires_thana() and category_allows_amount(). Those are plain SQL
-- functions, so they run as the CALLER, and the caller is nirapod_submit, which
-- has SELECT on nothing. So every INSERT died with "permission denied for table
-- subcategory_rules" even though the row was valid.
--
-- 0007 already granted exactly this for hazard_subcategory_rules, for exactly
-- this reason. The reports side was never granted because until now nothing had
-- ever connected as this role: the demo and the tests both run as the owner, so
-- the least-privilege design had never actually been exercised. It is worth
-- noting that the first time it ran, it caught three real over-reaches in the
-- Worker before this one.
--
-- LEAKS NOTHING. category_rules and subcategory_rules are the taxonomy: which
-- subcategories belong to which category, and which categories take an amount
-- band. The identical data is compiled into web/src/lib/taxonomy.js and shipped
-- to every visitor's browser. There is no report data here and no count.

BEGIN;

GRANT SELECT ON category_rules, subcategory_rules TO nirapod_submit;

COMMIT;
