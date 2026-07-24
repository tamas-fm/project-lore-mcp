# Architecture

## Overview

Aurora is a local-first mobile app. The client owns habit data in SQLite;
the backend exists only for accounts, sync, and entitlements.

## Authentication

Sessions use short-lived JWTs issued by the backend. The mobile client never
stores refresh tokens in plain storage — they live in the platform keychain.
This replaces the legacy cookie design described in
[the legacy auth design](legacy/auth-design.md), which is superseded.

## Persistence

Governed by [ADR-0002](adr/0002-sqlite-local-persistence.md).

## Premium entitlements

The commercial source of truth is the store subscription; the backend mirrors
entitlement state. Client code reads entitlements only through
`src/premium/entitlements.ts`.
