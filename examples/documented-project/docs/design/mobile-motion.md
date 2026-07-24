# Mobile motion

Scope: mobile package.

Depends on: [Colors](colors.md)

## Entrance transition

Screens fade in over 240ms with a 12px upward drift, easing `calm-out`.
Onboarding screens add a 60ms stagger between headline and body.

## Rules

- All animation uses Reanimated (see `mobile/CLAUDE.md`).
- No spring overshoot on onboarding — it reads as playful, which conflicts
  with the calm emotional progression.
