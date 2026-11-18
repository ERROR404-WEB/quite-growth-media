---
name: add-migration
description: Creates a new PostgreSQL migration for the Quiet Growth Media platform (tables, columns, indexes, constraints). Use when changing the database schema, adding a table or column, or when a feature needs new persisted data.
---

# Add a database migration

Migrations are plain SQL files in `migrations/`, applied in order by `src/db/migrate.ts`, each inside its own transaction. Applied migrations are checksummed, so **editing an applied file breaks startup**.

## Steps

1. Find the highest number: list `migrations/` and take the next 4-digit version (e.g. `0002`).
2. Create `migrations/NNNN_short_snake_case.sql`. Never edit an existing file; a fix is a new migration.
3. Follow the schema conventions:
   - Brand-scoped tables have `brand_id text NOT NULL REFERENCES brands (id) ON DELETE RESTRICT`.
   - Primary key `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` (brands use the text slug).
   - `created_at` / `updated_at timestamptz NOT NULL DEFAULT now()`, plus the trigger:
     `CREATE TRIGGER <table>_updated_at BEFORE UPDATE ON <table> FOR EACH ROW EXECUTE FUNCTION set_updated_at();`
   - Enumerations as `text` + `CHECK (col IN (...))`. If you add a value, update `src/domain/constants.ts`.
   - Add an index for every foreign key you query by, plus `(brand_id, created_at DESC)` for feeds.
   - Use UNIQUE constraints for idempotency (`idempotency_key`, natural keys).
   - Money: `numeric(14, 6)` + `currency char(3)`. Never store floats for money.
   - **Never store secrets.** Store a reference name (e.g. `credential_ref`), never a token or key.
   - Prefer additive changes (new nullable column → backfill → set NOT NULL in a later migration).
4. Apply it: `npm run db:migrate`, then `npm run db:status` (it should show 0 pending).
5. Update `tests/integration/api.test.ts` ("creates all N domain tables") if you added a table, and add an integration test for any new constraint.
6. Run `npm run check`.

## Checklist before finishing

- [ ] New file only; numbering continuous; filename is `NNNN_snake_case.sql`
- [ ] `brand_id` + FK on every brand-scoped table
- [ ] CHECK constraints mirrored in `src/domain/constants.ts`
- [ ] Indexes for FK lookups; unique constraints for idempotency
- [ ] No secret columns
- [ ] `npm run db:migrate` and `npm run check` pass
