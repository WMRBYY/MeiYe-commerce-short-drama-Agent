# 工作台前端

创作、短剧、电商与管理后台共用一个 React 应用。访问路径由 [router.tsx](src/router.tsx) 定义；页面在 [src/pages](src/pages)，请求封装在 [src/services/api](src/services/api)。

在本目录运行 `bun install --frozen-lockfile` 和 `bun run dev --host 127.0.0.1`。本地登录需要同时启动[后端](../docs/LOCAL_SETUP.md)。检查类型用 `bun run typecheck`，构建用 `bun run build`。
