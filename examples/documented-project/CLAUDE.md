# Aurora — project instructions

Aurora is a habit-tracking mobile app with a premium tier.

## Rules

- All persistence decisions are governed by ADR-0002 (SQLite). Do not add new
  storage mechanisms without an ADR.
- Premium UI must follow the product intent document: gold is used sparingly,
  never for full backgrounds.
- Read `docs/00-manifest.md` before starting any documented task.

## Security

- Entitlement checks happen server-side; see `src/premium/entitlements.ts`.
- Never log subscription receipts.
