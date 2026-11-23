# APIMart Flow Music

APIMart 专用异步音乐生成协议。模型 ID 固定为 `flowmusic`；Lyria 3.5 仍使用这个模型 ID，并设置 `providerOptions.apimart-flowmusic.version` 为 `lyria-3.5`。

请求为 `POST /v1/music/generations`，查询为 `GET /v1/music/tasks/{taskId}`。`prompt` 映射到 `sound_prompt`；其余可选字段与 APIMart 上游同名。音乐链接会标记为临时媒体，由宿主持久化。

官方文档：[Flow Music 生成](https://service-3778997d.example.invalid/cn/api-reference/audios/flow-music/music)、[Lyria 3.5](https://service-3778997d.example.invalid/cn/api-reference/audios/flow-music/music-lyria-3-5)、[查询任务](https://service-3778997d.example.invalid/cn/api-reference/audios/flow-music/query)。

完整接口见 [docs/interface.md](docs/interface.md)。
