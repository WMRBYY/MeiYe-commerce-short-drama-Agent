# APIMart Seedance 2.0

APIMart `seedance-2.0`、`seedance-2.0-fast` 和 `seedance-2.0-mini` 专用协议。创建 `POST /v1/videos/generations`，查询 `GET /v1/tasks/{taskId}`。

上游 Seedance 2.0 使用 `size` 和 `generate_audio`。参考图有明确 `first_frame`、`last_frame` 或 `reference_image` 角色时发送 `image_with_roles`，其余图片发送 `image_urls`；两种形式不能混用。其他可选参数放在 `providerOptions.apimart-seedance-2`。

官方文档：[Seedance 2.0 视频生成](https://service-3778997d.example.invalid/cn/api-reference/videos/seedance-2-0/generation)、[任务查询](https://service-3778997d.example.invalid/cn/api-reference/tasks/status)。完整接口见 [docs/interface.md](docs/interface.md)。
