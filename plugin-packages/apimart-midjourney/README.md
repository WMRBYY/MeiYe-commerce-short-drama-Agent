# APIMart Midjourney

独立声明式协议插件（`yingce.plugin/v2`），对应 APIMart 的 Imagine 文生图与垫图异步任务。渠道 API Key 由宿主保管，使用 Bearer 鉴权；生成结果由宿主下载并持久化。

上游模型 ID 是 `midjourney`，版本由 `version` 指定。本协议默认提交 `version: "8.2"`，不复用沧元 `midjourney-1k` / `midjourney-2k` 协议，也不向新版路由重复发送 `model`。

完整接口与参数来源见 [docs/interface.md](docs/interface.md)。
