# Design Sync Notes

## Repo-specific setup

- Package: `@club-erp/web` (frontend/), srcDir `src/components/ui`
- Build command: `pnpm --filter @club-erp/web build` from repo root
- Node modules: `frontend/node_modules`
- DesignSync project: fb5504d8-a74e-4ca4-b9a4-19e197b5420f

## Workspace symlink setup

`@club-erp/web` is a Vite app (no library dist), so `node_modules/@club-erp/web` doesn't exist. The converter needs it as PKG_DIR. A symlink is created once per clone:
```sh
mkdir -p frontend/node_modules/@club-erp
ln -sfn /home/erpadmin/club-erp/frontend frontend/node_modules/@club-erp/web
```
Because PKG_DIR resolves to the SYMLINK path (`frontend/node_modules/@club-erp/web`), paths in config that go "up" with `../` must account for the symlink depth (4 levels to reach repo root). That is why `tsconfig` uses `../../../../.design-sync/tsconfig-build.json` rather than `../.design-sync/...`.

## Re-sync risks

- **cssEntry goes stale on every frontend rebuild**: Vite content-hashes the output CSS (`dist/assets/index-<hash>.css`). Before running the driver, always check `ls frontend/dist/assets/index-*.css` and update `cssEntry` in `.design-sync/config.json` if the filename has changed (it will change whenever CSS changes).
- **ds-sync/node_modules**: already installed; on fresh clone, re-run `cd .ds-sync && npm i esbuild ts-morph @types/react`.
- **Authored previews**: Alert.tsx, Button.tsx, Card.tsx — check if the component API changed after a refactor.

## Known render warns

_(none recorded yet — populated after first re-sync render check)_
