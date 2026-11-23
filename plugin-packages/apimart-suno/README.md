# APIMart Suno V6

APIMart 专用异步音乐生成协议。固定模型 ID 为 `suno`。`custom=false` 时 `prompt` 是灵感描述；`custom=true` 时是歌词。其他字段保留 APIMart 原名，配置在 `providerOptions.apimart-suno` 中。

请求为 `POST /v1/music/generations`，查询为 `GET /v1/music/tasks/{taskId}`。创建响应读取 `data[0].task_id`，结果读取 `data.result.music[].audio_url`。媒体链接由宿主持久化。

官方文档：[生成音乐](https://service-3778997d.example.invalid/cn/api-reference/audios/suno/generation)、[V6 通用约定与查询](https://service-3778997d.example.invalid/cn/api-reference/audios/suno/overview)。

完整接口见 [docs/interface.md](docs/interface.md)。
