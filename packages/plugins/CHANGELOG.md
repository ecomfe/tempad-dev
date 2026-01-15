# Changelog

## 0.6.1

- Version bump only.

## 0.6.0

- Added build/publish scripts (`build`, `prepublishOnly`).

## 0.5.0

- Added `queryAll` / `queryOne` helpers for chaining multiple node queries.
- Defaulted `NodeQuery.visible` matching to `true` when omitted.

## 0.4.10

- Enhanced `find*` helpers: `NodeQuery` supports arrays/RegExp for string fields and helpers are typed via generics.

## 0.4.9

- Loosened TypeScript generics for better plugin author ergonomics.

## 0.4.8

- Exported the `DevComponent` type.

## 0.4.7

- Refined TypeScript types for plugin APIs.

## 0.4.6

- Improved `h()` typing.

## 0.4.5

- Version bump only.

## 0.4.4

- Added generics to `h()` typing.

## 0.4.3

- Added `NodeQuery.visible`.
- Added generics to `DevComponent` typing.

## 0.4.2

- Version bump only.

## 0.4.1

- Version bump only.

## 0.4.0

- Version bump only.

## 0.3.2

- Improved `DesignNode` typings.

## 0.3.1

- Fixed `NodeQuery` typing.

## 0.3.0

- Added `children` support in `DesignComponent`/node types.
- Added `findChild` / `findChildren` / `findOne` / `findAll` helpers for querying the node tree.

## 0.2.1

- Stopped publishing internal `dist/shared/*` artifacts.

## 0.2.0

- Added `transformComponent` support to allow transforming design components into dev components.

## 0.1.0

- Initial release of the plugins SDK.
