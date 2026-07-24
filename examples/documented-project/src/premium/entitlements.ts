// Referenced by docs/architecture.md and CLAUDE.md as the only entry point
// for entitlement checks. Fixture file — not indexed (code, not documentation).
export function hasPremium(entitlements: ReadonlySet<string>): boolean {
  return entitlements.has("premium");
}
