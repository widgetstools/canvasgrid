# @wellsfargo-starui/velocity-grid-ext

`VelocityGridExt` — cgrid's self-contained, batteries-included wrapper: owns a `VelocityGrid`
and layers on all config tooling (two-tier toolbar, settings sheet, profiles)
via a plugin/extension registry. Zero StarUI dependency.

**Status:** Wave 0 (spine). See
`docs/superpowers/specs/2026-07-07-cgridext-foundation-design.md` and
`docs/superpowers/plans/2026-07-07-cgridext-foundation-wave0-spine.md`.


## Config persistence (ConfigSession)

Ext persists **view state + layouts + profiles** through a {@link ConfigSession}
(default: `LocalStorageConfigSession` keyed by `options.gridId`).

- Instance key: `velocity-grid:instance:<gridId>` (Markets-aligned bundle)
- Provider **definitions** stay in `@wellsfargo-starui/velocity-grid-data` catalog — only `{ activeProviderId }` rides state / `gridLevelData`
- AppData (`{{tokens}}`) is a separate KV plane — see `docs/starui-platform/03-config-planes.md`

Host Config Managers (Dexie / REST / identity) should implement `ConfigSession` or `ProfileStore` and pass `ext.profiles.store`.

**Naming:** do not confuse Ext `getConfig()` (JSON workspace) with kernel `grid.getConfig()` (runtime options) or Markets `configManager.getConfig(configId)`.
