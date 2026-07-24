# Mobile package instructions

Scope: these rules apply only to code under `mobile/`.

## Animation

- Use React Native Reanimated for all animation. The legacy `Animated` API is
  forbidden in new code.
- Motion timing tokens come from `../docs/design/mobile-motion.md`.

## Navigation

- Screens register through the typed route table in `mobile/src/routes.ts`.
