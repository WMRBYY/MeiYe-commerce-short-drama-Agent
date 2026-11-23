# 服务商目录

`catalog.example.json` 只用于说明目录字段格式，其中的服务地址仅为示例。仓库不包含可用的中转站地址、生产目录或 API Key。

如需提供远程静态目录，请设置 `CANVAS_PROVIDER_CATALOG_URL` 和可选的 `CANVAS_PROVIDER_CATALOG_LOGO_BASE`，并在自有 HTTPS 主机上托管目录 JSON 与 Logo。未配置目录地址时不请求远程服务，内置目录仍可用。`Caddyfile.snippet` 使用示例域名，部署前请替换为实际域名并核对证书和站点路由。生产目录与密钥应保存在仓库之外。
