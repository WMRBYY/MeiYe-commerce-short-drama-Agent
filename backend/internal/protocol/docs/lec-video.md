# Lec API Videos

适用于 Lec API 的 `lec-vp-seedance-2-5-m2` 等公开视频模型。Base URL 填 `https://service-a99af70e.example.invalid`；模型 ID 使用 Lec 文档中的公开 ID。

## 接口

{{OPERATIONS}}

## 模型

`lec-vp-seedance-2-5-m2` 是当前内置的 Lec 视频模型示例；后台仍应按实际渠道目录和模型能力配置价格与发布范围。

创建任务使用 JSON，请求体直接包含 `model`、`prompt`、`duration`、`aspect_ratio`、`resolution`，以及可选的 `images`、`videos`、`audios` 公网 HTTPS URL 数组。不要把它配置成 NewAPI Video Generations：后者发送 `/v1/video/generations` 和 `audio_urls` 等不同字段。

`lec-vp-seedance-2-5-m2` 支持 4–30 秒整数、480p/720p/1080p、最多 30 张图、10 段视频和 10 段音频参考。创建请求不自动重试；返回任务 ID 后查询 `GET /v1/videos/{task_id}`。媒体 URL 必须能被 Lec 服务端公开访问。

## 参数

{{PARAMETERS}}

{{CONTRACT}}

## 官方

上游来源：[Lec API 模型文档](https://service-a99af70e.example.invalid/docs)。
