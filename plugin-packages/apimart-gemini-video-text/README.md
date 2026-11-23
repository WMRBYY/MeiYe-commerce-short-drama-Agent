# APIMart Gemini 视频理解

完整视频以 video_url 内容块传入 `/v1/chat/completions`，使用 Bearer API Key；不转成图片。必须确认所选上游模型接受完整视频，否则保持报错。Google 原生渠道请使用 gemini-multimodal-text。
