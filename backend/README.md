# 服务端

[cmd/server](cmd/server) 是 HTTP 服务入口。[internal/handler](internal/handler) 接收请求，[internal/app](internal/app) 处理业务流程，[internal/repository](internal/repository) 负责读写数据。

按[本地开发指南](../docs/LOCAL_SETUP.md)启动独立的数据目录。管理后台中的渠道、账号和任务记录属于当前实例；配置新实例时，请使用自己的凭证。
