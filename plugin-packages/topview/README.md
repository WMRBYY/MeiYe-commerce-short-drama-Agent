# TopView

视频接口必须使用官方模型显示名，例如 `Kling 4.0`。插件会将已知的 `kling-4.0` 标识转换为该显示名，覆盖文生与图生视频；不会把模型替换为其他版本。后台模型与计价档位仍应填写 `Kling 4.0`。

带参考视频或纯参考图进入全能参考接口时，可灵 4.0 使用官方名称 `Kling 4.0 Omni`（同代模型的参考编辑模式）；普通文生和首尾帧图生仍使用 `Kling 4.0`。Omni 不支持参考音频，保留原声由宿主在成片阶段处理。

该目录是独立官方协议插件源码。后端从生成的 `topview.yingce-plugin` 包加载，不依赖系统内置 `host:` 适配器。

插件对接 TopView OpenAPI（`https://api.topview.ai`），提供三个协议：

- `topview-video`：TopView 视频（文生/图生/参考视频）。同一个协议按输入自动选择 TopView 接口：
  - 纯文字 → 文生视频（text2video）；
  - 首帧/尾帧图片 → 图生视频（image2video v2）；
  - 参考视频、参考音频，或参考图（模型不是 Reference to video 系列时）→ 全能参考（omni_reference，视频生视频、视频编辑、视频延长）。
- `topview-image`：TopView 图片（文生图，text2image）。
- `topview-tts`：TopView 配音（文字转语音，text2voice）。

## 渠道配置

- Base URL：`https://api.topview.ai`。
- API Key：TopView 控制台生成的 API Key，只填 `sk-...` 本身，不带 `Bearer` 前缀。
- 自定义请求头：`Topview-Uid`，值为 TopView 控制台里的 UID。TopView 文档要求每个请求都带这个请求头，插件会把渠道自定义请求头原样附加到提交、查询和素材上传申请请求上。
- 模型：TopView 没有 OpenAI 风格的模型目录接口，「拉取模型」不可用，需要手动添加模型。上游模型名填 TopView 文档里的模型显示名，例如 `Seedance 2.5`、`Kling V3`、`Veo 3.1`、`Kling O3 Video-Edit`、`Nano Banana Pro`、`GPT Image 2`；配音模型填 `elevenlabs-v4`、`minimax-v2.5` 等。
- 视频模型要用参考视频或参考音频时，在模型的「引用与限制」里把视频、音频数量上限调成大于 0。

## 素材上传

图片、视频、音频按 TopView 的三步流程上传后再提交任务：申请上传凭证（`/v1/upload/credential`）→ 宿主把文件直传到返回的 S3 预签名地址 → 校验（`/v1/upload/check`）。直传请求不带渠道 Key 和 UID。

## 当前限制

- 文生图仍只支持纯文字（不发送参考图）。
- 每个模型支持的画幅、分辨率、时长、素材数量不同，以 TopView 文档为准；超出范围时 TopView 返回的错误信息会原样展示。视频编辑类模型（例如 Grok Video Edit、Wan 2.7 Video Edit）不接受时长、画幅时，请在模型配置里关闭对应参数。

完整接口见 [docs/interface.md](docs/interface.md)。
