# 开发与校验脚本

从仓库根目录运行 `bun scripts/verify-before-push.mjs`，按相对于主分支的改动选择验证范围。只查前端可加 `--only web`，全量检查可加 `--all`。日志保存在本机的 `.local/cache/verify/`。

[校验入口](verify-before-push.mjs) 与[本地开发指南](../docs/LOCAL_SETUP.md)分别说明检查选项和启动步骤。
