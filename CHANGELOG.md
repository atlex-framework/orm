# Changelog

## 0.2.2

### Patch Changes

- b87b80b: Improve migrations

## 0.2.1

### Patch Changes

- 1256d74: Update orm, add time()

## 0.2.0

### Minor Changes

- Synchronized 0.2.0 release across the whole monorepo.

  All 13 packages are republished at a single aligned `0.2.0` so downstream
  consumers re-resolve their dependency trees and pick up patched transitive
  dependencies:
  - `ws@>=8.20.1` (via `engine.io@6.6.8` / `socket.io-adapter@2.5.7`) —
    fixes GHSA-58qx-3vcg-4xpx (uninitialized memory disclosure).
  - `qs@>=6.15.2` (via `express@5`) — fixes GHSA-q8mj-m7cp-5q26
    (remotely-triggerable DoS in `qs.stringify`).

  `@atlex/mail` additionally bumps its `nodemailer` dependency `^6.9.0 -> ^8.0.7`
  (and `@types/nodemailer` to `^8`), moving off the nodemailer 6.x line at the
  source so consumers no longer need a local `nodemailer` override. The
  `createTransport` / `sendMail` / `Transporter` API used by the SMTP and SES
  drivers is unchanged; typecheck, all 31 mail tests, and the build pass.

  Internal `@atlex/*` peer-dependency ranges were relaxed from the exact
  `workspace:*` pin to `workspace:>=0.1.0` so the synchronized minor bump does
  not force a major version on peer-dependent packages. No source/API changes.

## 0.1.11

### Patch Changes

- de7b9ba: Fix cli

## 0.1.10

### Patch Changes

- da7ec68: Add enum, uuid columns
- Updated dependencies [da7ec68]
  - @atlex/config@0.1.9

## 0.1.8

### Patch Changes

- 36c90f5: Att api.ts
- Updated dependencies [36c90f5]
  - @atlex/config@0.1.8

## 0.1.7

### Patch Changes

- ff97bcb: @atlex/core — WebSocket server with JWT auth on upgrade, room-based broadcasting (WsGateway, WsClient, WsRoom)
  @atlex/notifications — APNs critical alerts that bypass Do Not Disturb (ApnsCriticalAlert, ApnsChannel)
  @atlex/storage — Cloudflare R2 driver + getPresignedUrl() on all S3-compatible disks
- Updated dependencies [ff97bcb]
  - @atlex/config@0.1.7

## 0.1.6

### Patch Changes

- 0240bf4: Add Google and Apple OAuth2 provider
- Updated dependencies [0240bf4]
  - @atlex/config@0.1.6

## 0.1.5

### Patch Changes

- bf41f02: Fix CLI
- Updated dependencies [bf41f02]
  - @atlex/config@0.1.5

## 0.1.4

### Patch Changes

- 31fa47d: Update documentations and remove depricated packages
- Updated dependencies [31fa47d]
  - @atlex/config@0.1.4

## 0.1.3

### Patch Changes

- fac4c29: Update documentation
- Updated dependencies [fac4c29]
  - @atlex/config@0.1.3

## 0.1.2

### Patch Changes

- 935a47e: Fix CLI
- Updated dependencies [935a47e]
  - @atlex/config@0.1.2

## 0.1.0-beta

Initial published line for this package (pre-1.0).
