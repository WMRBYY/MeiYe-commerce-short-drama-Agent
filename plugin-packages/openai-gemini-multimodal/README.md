# OpenAI 兼容 Gemini 多模态

用 OpenAI 兼容的 `/v1/chat/completions`（Bearer API Key）调用 Gemini 模型，同一个协议覆盖文本、图片和视频理解。适用于只开放 OpenAI 格式、不放行 `/v1beta/models/*:generateContent` 原生接口的中转站。Google 官方或放行 `/v1beta` 的渠道请用 gemini-multimodal-text。

- 文本：普通 messages。
- 图片：`image_url`，默认以 data URL 内嵌，不需要上游回源下载。
- 视频：爆款复刻/商品视频分析在服务端按约 1 帧/秒抽帧（每条消息最多 16 张）内嵌为 `image_url`，完整音轨以 `input_audio`（mp3）发送；其他场景的视频以 `video_url` 发送，需上游支持。

渠道地址填中转站 API 地址（带不带 /v1 都可以），模型填中转站实际暴露的 Gemini 模型 ID。
