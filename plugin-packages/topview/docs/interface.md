# TopView 接口字段

## 协议身份

- 插件 ID：`topview`。
- Provider ID：`topview-video`（能力 `video`）、`topview-image`（能力 `image`）、`topview-tts`（能力 `audio`）。
- 默认 Base URL：`https://api.topview.ai`。
- 鉴权驱动：`bearer`，请求头 `Authorization: Bearer <apiKey>`。
- 附加请求头：`Topview-Uid`，由渠道「自定义请求头」提供，宿主会附加到提交、查询和素材上传申请/校验请求；直传到 S3 的请求不带。
- 统一响应外壳：`{"code":"200","message":"Success","result":{...}}`；任务状态为 `init`、`running`、`success`、`fail`。

## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | TopView API Key（不带 `Bearer` 前缀） |

## topview-video：文生 / 图生 / 参考视频

同一个协议按输入选择 TopView 接口（`create.pathTemplate`），任务 ID 带上入口前缀，查询时按前缀选择查询接口：

| 输入 | 接口 | 任务 ID 前缀 | 查询 |
| --- | --- | --- | --- |
| 只有文字 | `POST /v1/common_task/text2video/task/submit` | `t2v:` | `GET /v1/common_task/text2video/task/query` |
| 有首帧/尾帧图片（角色 `first_frame`、`last_frame` 或未指定） | `POST /v2/common_task/image2video/task/submit` | `i2v:` | `GET /v2/common_task/image2video/task/query` |
| 只有参考图，且模型名含 `reference` 或为 `Gemini Omni Flash` | `POST /v2/common_task/image2video/task/submit`（`referenceImageFileIds`） | `i2v:` | 同上 |
| 有参考视频或参考音频；或只有参考图且模型不属于上一行 | `POST /v1/common_task/omni_reference/task/submit` | `omni:` | `GET /v1/common_task/omni_reference/task/query` |

`providerOptions.topview-video.imageMode` 可设为 `image2video` 或 `omni`，强制纯参考图走哪个接口。没有前缀的旧任务 ID 按文生视频查询。

### 素材上传

图片、视频、音频提交前逐个上传，同一素材只上传一次：

1. `GET /v1/upload/credential?format=<格式>`（渠道鉴权），格式由素材 MIME 换算：`png`、`jpg`、`webp`、`bmp`、`mp4`、`mov`、`avi`、`mp3`、`wav`、`m4a`；识别不出时按类型取 `png`/`mp4`/`mp3`。素材 ID 取 `result.fileId`。
2. 宿主把文件原始字节 `PUT` 到 `result.uploadUrl`（只允许 HTTPS，不带渠道 Key 和自定义请求头）。
3. `GET /v1/upload/check?fileId=<fileId>`（渠道鉴权），`code` 为 `"200"` 且 `result` 为 `true` 才算上传成功。

### 统一字段映射

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | TopView 视频模型显示名，例如 `Seedance 2.5`、`Kling V3`、`Veo 3.1`、`Kling O3 Video-Edit`。 |
| `prompt` | string | 是 | `prompt` | 视频提示词；全能参考模式下 `@图片N`/`@视频N`/`@音频N` 改写为 `<<<ImageN>>>`/`<<<VideoN>>>`/`<<<AudioN>>>`。 |
| `images` | media[] | 否 | `firstFrameFileId/endFrameFileId/referenceImageFileIds/inputImages` | 图片先上传换 fileId；首帧/尾帧走图生视频，纯参考图按上表选择接口。 |
| `videos` | media[] | 否 | `inputVideos` | 参考视频先上传换 fileId，走全能参考。 |
| `audios` | media[] | 否 | `inputAudios` | 参考音频先上传换 fileId，走全能参考。 |
| `duration` | integer | 否 | `duration` | 时长秒数；0 表示不传，由 TopView 使用模型默认时长。 |
| `aspectRatio` | string | 否 | `aspectRatio` | 画幅比例；图生视频带首尾帧时不传，由图片决定。 |
| `resolution` | string | 否 | `resolution` | `360p/480p/540p/720p/768p/1080p/1440p(2k)/2160p(4k)` 转换为整数 360-2160；无法识别时不传。 |
| `generateAudio` | boolean | 否 | `sound` | 文生/图生视频：`true` 发送 `on`，`false` 发送 `off`；全能参考不发送。 |
| `providerOptions` | object | 否 | provider-specific fields | 厂商扩展字段，见下方扩展键。 |

### 上游请求字段

| 上游字段 | 适用接口 | 取值 |
| --- | --- | --- |
| `model` | 全部 | `request.model` |
| `prompt` | 全部 | 文生视频原样发送；图生视频为空时不传；全能参考做 `@图片N` 等改写 |
| `firstFrameFileId` | 图生视频 | 第一张角色为 `first_frame` 或未指定的图片的 fileId |
| `endFrameFileId` | 图生视频 | 第一张角色为 `last_frame` 的图片的 fileId |
| `referenceImageFileIds` | 图生视频 | 角色为 `reference_image` 的图片 fileId 列表 |
| `inputImages` / `inputVideos` / `inputAudios` | 全能参考 | `{fileId, name}`，name 依次为 `Image1`…、`Video1`…、`Audio1`… |
| `aspectRatio` | 全部 | `providerOptions.topview-video.aspectRatio` 优先，否则 `request.aspectRatio`；图生视频带首尾帧时不传 |
| `resolution` | 全部 | `providerOptions.topview-video.resolution` 优先，否则按上表转换 `request.resolution` |
| `duration` | 全部 | `providerOptions.topview-video.duration` 优先，否则 `request.duration`（非 0 时） |
| `sound` | 文生、图生视频 | 由 `request.generateAudio` 转换；未设置时取 `providerOptions.topview-video.sound` |
| `generatingCount` | 全部 | `providerOptions.topview-video.generatingCount`，默认 `1` |
| `draftMode` | 全部 | `providerOptions.topview-video.draftMode`，未设置时不传（仅 Seedance 2.5 支持） |
| `internetSearch` | 全能参考 | `providerOptions.topview-video.internetSearch`，未设置时不传 |

### 扩展键

- `providerOptions.topview-video.imageMode`
- `providerOptions.topview-video.aspectRatio`
- `providerOptions.topview-video.resolution`
- `providerOptions.topview-video.duration`
- `providerOptions.topview-video.sound`
- `providerOptions.topview-video.generatingCount`
- `providerOptions.topview-video.draftMode`
- `providerOptions.topview-video.internetSearch`

## topview-image：文生图

- 创建：`POST /v1/common_task/text2image/task/submit`。
- 查询：`GET /v1/common_task/text2image/task/query?taskId={{taskId}}`。
- 图片参数：`ratio`（画幅比例，绑定 `aspectRatio`，默认 `1:1`）、`imageResolution`（分辨率 `1K/2K/4K/512p`，绑定 `resolution`，默认 `2K`）、`count`（生成数量 1-4，绑定 `imageCount`，默认 1）。

### 统一字段映射

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | TopView 图片模型显示名，例如 `Nano Banana Pro`、`Seedream 4.5`、`GPT Image 2`。 |
| `prompt` | string | 是 | `prompt` | 图片提示词。 |
| `images` | media[] | 否 | unsupported | 当前版本不支持参考图或图片编辑，传入时直接报错。 |
| `imageCount` | integer | 否 | `generateCount` | 输出数量 1-4，未设置时为 1，超过 4 直接报错。 |
| `aspectRatio` | string | 否 | `aspectRatio` | 画幅比例，例如 `1:1`、`16:9`、`9:16`。 |
| `resolution` | string | 否 | `resolution` | `1K/2K/4K/512p`（大小写不敏感），未设置时为 `2K`；模型为 `Nano Banana` 或 `Kontext-Pro` 时不传。 |
| `providerOptions` | object | 否 | provider-specific fields | 厂商扩展字段，见下方扩展键。 |

### 上游请求字段

| 上游字段 | 取值 |
| --- | --- |
| `model` | `request.model` |
| `prompt` | `request.prompt` |
| `aspectRatio` | `request.aspectRatio`，为空时取 `providerOptions.topview-image.aspectRatio`，都为空时不传 |
| `resolution` | `providerOptions.topview-image.resolution` 优先，否则转换 `request.resolution`，默认 `2K` |
| `generateCount` | `max(request.imageCount, 1)` |
| `quality` | `providerOptions.topview-image.quality`，未设置时不传（仅 Midjourney、GPT Image 系列支持） |

### 扩展键

- `providerOptions.topview-image.aspectRatio`
- `providerOptions.topview-image.resolution`
- `providerOptions.topview-image.quality`

## topview-tts：文字转语音

- 创建：`POST /v1/voice/text2voice/task/submit`。
- 查询：`GET /v1/voice/text2voice/task/query?taskId={{taskId}}`。

### 统一字段映射

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `voiceModel` | 值为 `minimax-v2.5`、`elevenlabs-v2.5`、`elevenlabs-v3`、`elevenlabs-v4` 之一时作为 `voiceModel` 发送；其他值不发送，使用 TopView 默认配音模型。 |
| `prompt` | string | 是 | `voiceText` | 待合成文本，可使用 TopView 的 `<break time="1.0s"/>` 停顿标签。 |
| `providerOptions` | object | 否 | provider-specific fields | 厂商扩展字段，见下方扩展键。 |

### 上游请求字段

| 上游字段 | 取值 |
| --- | --- |
| `voiceId` | `request.extra.audioVoice`（长度不少于 16 个字符时视为 TopView 音色 ID）→ `providerOptions.topview-tts.voiceId` → 默认 `6365baea832941c8842db62a87a3e98e`。界面默认的 `alloy` 等 OpenAI 音色名会被忽略。 |
| `voiceText` | `request.prompt` |
| `voiceSpeed` | `request.extra.audioSpeed` 限制在 0.8-1.2 → `providerOptions.topview-tts.voiceSpeed` → `1` |
| `voiceModel` | 见上表 `model`；否则取 `providerOptions.topview-tts.voiceModel`，都为空时不传 |
| `emotionName` | `providerOptions.topview-tts.emotionName`，未设置时不传 |

### 扩展键

- `providerOptions.topview-tts.voiceId`
- `providerOptions.topview-tts.voiceSpeed`
- `providerOptions.topview-tts.voiceModel`
- `providerOptions.topview-tts.emotionName`

## 响应映射

三个协议共用同一套状态规则，创建响应和查询响应都按这套规则解析：

| 映射位置 | 规则 |
| --- | --- |
| `response.taskId` | 视频：创建时为入口前缀加 `result.taskId`（`t2v:`/`i2v:`/`omni:`），查询时沿用宿主保存的带前缀 ID；图片、配音：`result.taskId`，为空时沿用宿主保存的 `taskId` |
| `response.status` | `code` 非空且不等于 `"200"` → `failed`；否则按 `result.status`：`success` 且有结果文件 → `succeeded`，`success` 但没有结果文件 → `failed`，`fail/failed/failure/error` → `failed`，`running` → `processing`，`init` → `pending`，其他值交给宿主标准状态归一化 |
| `response.message` | 业务错误时为 `TopView 返回错误（code X）：message`；否则依次取 `result.errorMsg`、第一个子任务 `errorMsg`、结果为空的提示 |
| `response.videos` | `result.videos[].filePath` 中的非空 URL |
| `response.images` | `result.images[].filePath` 中的非空 URL |
| `response.audios` | `result.voice.demoAudioUrl`，依次回退 `result.voice.audioUrl`、`result.audioUrl`、`result.filePath` |
| `response.resultEphemeral` | `true` |

## 响应与错误

- TopView 业务错误以 HTTP 200 + 非 `"200"` 的 `code` 返回（例如 `4004 Task not found.`），插件把它映射为失败并保留 TopView 的原始 message。
- HTTP 401 等传输层错误由宿主按 HTTP 失败处理。
- TopView 结果文件 URL 是临时地址，标记为 ephemeral，由宿主立即下载持久化。
- `generatingCount` 大于 1 时，父任务 `success` 只表示全部子任务结束；插件只收集有 `filePath` 的子任务结果。

## 兼容边界

- 视频覆盖文生视频、图生视频（首尾帧、多图参考）和全能参考（参考图/视频/音频，含视频编辑、视频延长类模型）；文生图仍只发送文字。
- 素材上传依赖宿主的三步上传（申请地址 → HTTPS 直传 → 确认），需要支持 `upload.transfer` / `upload.confirm` 的后端版本。
- 各模型对画幅、时长、分辨率、素材数量的限制由 TopView 校验，错误信息原样返回；视频编辑类模型不接受的参数请在模型配置里关闭。
- TopView 没有模型目录接口，模型需要在后台手动添加。

提交与回查共用响应映射：提交响应即使为 `success`，只要没有媒体且尚无回查任务 ID，就按已受理继续查询；回查 `success` 但无媒体仍报结果缺失，禁止重新提交。此规则同时适用于视频、图片和配音。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "topview",
  "name": "TopView",
  "version": "1.1.3",
  "author": "TopView / MeiyeAI",
  "description": "TopView OpenAPI 独立请求协议插件：文生视频、图生视频、全能参考（参考图/视频/音频）、文生图、文字转语音。",
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>",
  "permissions": [
    "generation.run",
    "media.read"
  ],
  "configuration": {
    "fields": [
      {
        "name": "apiKey",
        "type": "secret",
        "label": "API Key",
        "required": true
      }
    ]
  },
  "contributes": {
    "providers": [
      {
        "id": "topview-video",
        "label": "TopView 视频（文生/图生/参考视频）",
        "capabilities": [
          "video"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://api.topview.ai",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "parameters": [
          {
            "name": "model",
            "type": "string",
            "required": true,
            "mapping": "model",
            "description": "TopView 视频模型显示名，例如 Seedance 2.5、Kling V3、Veo 3.1、Kling O3 Video-Edit。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "视频提示词；全能参考模式下 @图片N/@视频N/@音频N 改写为 <<<ImageN>>>/<<<VideoN>>>/<<<AudioN>>>。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "firstFrameFileId/endFrameFileId/referenceImageFileIds/inputImages",
            "description": "图片先上传到 TopView 换 fileId；首帧/尾帧走图生视频，纯参考图按模型走图生视频多图参考或全能参考。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "required": false,
            "mapping": "inputVideos",
            "description": "参考视频先上传换 fileId，走全能参考（视频生视频、视频编辑、视频延长）。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "inputAudios",
            "description": "参考音频先上传换 fileId，走全能参考。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "duration",
            "description": "时长秒数；0 表示不传，由 TopView 使用模型默认时长。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "aspectRatio",
            "description": "画幅比例；图生视频带首尾帧时不传，由图片决定。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution",
            "description": "分辨率档位（如 720p、1080p、4k），转换为 TopView 的整数分辨率；无法识别时不传。"
          },
          {
            "name": "generateAudio",
            "type": "boolean",
            "required": false,
            "mapping": "sound",
            "description": "文生/图生视频：true 发送 sound=on，false 发送 sound=off；全能参考不发送。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "required": false,
            "mapping": "provider-specific fields",
            "description": "插件命名空间内的厂商扩展字段，例如 imageMode、generatingCount、draftMode、internetSearch。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/common_task/text2video/task/submit",
          "pathTemplate": {
            "$switch": {
              "cases": [
                {
                  "when": {
                    "$or": [
                      {
                        "$gt": [
                          {
                            "$add": [
                              {
                                "$len": {
                                  "$ref": "request.videos"
                                }
                              },
                              {
                                "$len": {
                                  "$ref": "request.audios"
                                }
                              }
                            ]
                          },
                          0
                        ]
                      },
                      {
                        "$and": [
                          {
                            "$gt": [
                              {
                                "$len": {
                                  "$ref": "request.images"
                                }
                              },
                              0
                            ]
                          },
                          {
                            "$not": {
                              "$gt": [
                                {
                                  "$len": {
                                    "$filter": {
                                      "from": {
                                        "$ref": "request.images"
                                      },
                                      "as": "media",
                                      "where": {
                                        "$in": [
                                          {
                                            "$ref": "media.role"
                                          },
                                          [
                                            "first_frame",
                                            "last_frame",
                                            ""
                                          ]
                                        ]
                                      }
                                    }
                                  }
                                },
                                0
                              ]
                            }
                          },
                          {
                            "$not": {
                              "$switch": {
                                "cases": [
                                  {
                                    "when": {
                                      "$eq": [
                                        {
                                          "$lower": {
                                            "$trim": {
                                              "$ref": "request.providerOptions.topview-video.imageMode"
                                            }
                                          }
                                        },
                                        "omni"
                                      ]
                                    },
                                    "then": false
                                  },
                                  {
                                    "when": {
                                      "$eq": [
                                        {
                                          "$lower": {
                                            "$trim": {
                                              "$ref": "request.providerOptions.topview-video.imageMode"
                                            }
                                          }
                                        },
                                        "image2video"
                                      ]
                                    },
                                    "then": true
                                  }
                                ],
                                "default": {
                                  "$or": [
                                    {
                                      "$gt": [
                                        {
                                          "$len": {
                                            "$split": [
                                              {
                                                "$lower": {
                                                  "$ref": "request.model"
                                                }
                                              },
                                              "reference"
                                            ]
                                          }
                                        },
                                        1
                                      ]
                                    },
                                    {
                                      "$eq": [
                                        {
                                          "$lower": {
                                            "$trim": {
                                              "$ref": "request.model"
                                            }
                                          }
                                        },
                                        "gemini omni flash"
                                      ]
                                    }
                                  ]
                                }
                              }
                            }
                          }
                        ]
                      }
                    ]
                  },
                  "then": "/v1/common_task/omni_reference/task/submit"
                },
                {
                  "when": {
                    "$gt": [
                      {
                        "$len": {
                          "$ref": "request.images"
                        }
                      },
                      0
                    ]
                  },
                  "then": "/v2/common_task/image2video/task/submit"
                }
              ],
              "default": "/v1/common_task/text2video/task/submit"
            }
          },
          "contentType": "application/json",
          "body": {
            "$switch": {
              "cases": [
                {
                  "when": {
                    "$or": [
                      {
                        "$gt": [
                          {
                            "$add": [
                              {
                                "$len": {
                                  "$ref": "request.videos"
                                }
                              },
                              {
                                "$len": {
                                  "$ref": "request.audios"
                                }
                              }
                            ]
                          },
                          0
                        ]
                      },
                      {
                        "$and": [
                          {
                            "$gt": [
                              {
                                "$len": {
                                  "$ref": "request.images"
                                }
                              },
                              0
                            ]
                          },
                          {
                            "$not": {
                              "$gt": [
                                {
                                  "$len": {
                                    "$filter": {
                                      "from": {
                                        "$ref": "request.images"
                                      },
                                      "as": "media",
                                      "where": {
                                        "$in": [
                                          {
                                            "$ref": "media.role"
                                          },
                                          [
                                            "first_frame",
                                            "last_frame",
                                            ""
                                          ]
                                        ]
                                      }
                                    }
                                  }
                                },
                                0
                              ]
                            }
                          },
                          {
                            "$not": {
                              "$switch": {
                                "cases": [
                                  {
                                    "when": {
                                      "$eq": [
                                        {
                                          "$lower": {
                                            "$trim": {
                                              "$ref": "request.providerOptions.topview-video.imageMode"
                                            }
                                          }
                                        },
                                        "omni"
                                      ]
                                    },
                                    "then": false
                                  },
                                  {
                                    "when": {
                                      "$eq": [
                                        {
                                          "$lower": {
                                            "$trim": {
                                              "$ref": "request.providerOptions.topview-video.imageMode"
                                            }
                                          }
                                        },
                                        "image2video"
                                      ]
                                    },
                                    "then": true
                                  }
                                ],
                                "default": {
                                  "$or": [
                                    {
                                      "$gt": [
                                        {
                                          "$len": {
                                            "$split": [
                                              {
                                                "$lower": {
                                                  "$ref": "request.model"
                                                }
                                              },
                                              "reference"
                                            ]
                                          }
                                        },
                                        1
                                      ]
                                    },
                                    {
                                      "$eq": [
                                        {
                                          "$lower": {
                                            "$trim": {
                                              "$ref": "request.model"
                                            }
                                          }
                                        },
                                        "gemini omni flash"
                                      ]
                                    }
                                  ]
                                }
                              }
                            }
                          }
                        ]
                      }
                    ]
                  },
                  "then": {
                    "model": {
                      "$if": {
                        "condition": {
                          "$in": [
                            {
                              "$lower": {
                                "$trim": {
                                  "$ref": "request.model"
                                }
                              }
                            },
                            [
                              "kling-4.0",
                              "kling 4.0",
                              "kling-v4-omni",
                              "kling 4.0 omni"
                            ]
                          ]
                        },
                        "then": "Kling 4.0 Omni",
                        "else": {
                          "$ref": "request.model"
                        }
                      }
                    },
                    "prompt": {
                      "$replaceAll": {
                        "in": {
                          "$ref": "request.prompt"
                        },
                        "pairs": {
                          "$concatArrays": [
                            {
                              "$map": {
                                "from": {
                                  "$ref": "request.images"
                                },
                                "as": "media",
                                "in": [
                                  {
                                    "$concat": [
                                      "@图片",
                                      {
                                        "$add": [
                                          {
                                            "$ref": "mediaIndex"
                                          },
                                          1
                                        ]
                                      }
                                    ]
                                  },
                                  {
                                    "$concat": [
                                      "<<<",
                                      "Image",
                                      {
                                        "$add": [
                                          {
                                            "$ref": "mediaIndex"
                                          },
                                          1
                                        ]
                                      },
                                      ">>>"
                                    ]
                                  }
                                ]
                              }
                            },
                            {
                              "$map": {
                                "from": {
                                  "$ref": "request.videos"
                                },
                                "as": "media",
                                "in": [
                                  {
                                    "$concat": [
                                      "@视频",
                                      {
                                        "$add": [
                                          {
                                            "$ref": "mediaIndex"
                                          },
                                          1
                                        ]
                                      }
                                    ]
                                  },
                                  {
                                    "$concat": [
                                      "<<<",
                                      "Video",
                                      {
                                        "$add": [
                                          {
                                            "$ref": "mediaIndex"
                                          },
                                          1
                                        ]
                                      },
                                      ">>>"
                                    ]
                                  }
                                ]
                              }
                            },
                            {
                              "$map": {
                                "from": {
                                  "$ref": "request.audios"
                                },
                                "as": "media",
                                "in": [
                                  {
                                    "$concat": [
                                      "@音频",
                                      {
                                        "$add": [
                                          {
                                            "$ref": "mediaIndex"
                                          },
                                          1
                                        ]
                                      }
                                    ]
                                  },
                                  {
                                    "$concat": [
                                      "<<<",
                                      "Audio",
                                      {
                                        "$add": [
                                          {
                                            "$ref": "mediaIndex"
                                          },
                                          1
                                        ]
                                      },
                                      ">>>"
                                    ]
                                  }
                                ]
                              }
                            }
                          ]
                        }
                      }
                    },
                    "inputImages": {
                      "$omitEmpty": {
                        "$map": {
                          "from": {
                            "$ref": "request.images"
                          },
                          "as": "media",
                          "in": {
                            "fileId": {
                              "$ref": "media.uploadId"
                            },
                            "name": {
                              "$concat": [
                                "Image",
                                {
                                  "$add": [
                                    {
                                      "$ref": "mediaIndex"
                                    },
                                    1
                                  ]
                                }
                              ]
                            }
                          }
                        }
                      }
                    },
                    "inputVideos": {
                      "$omitEmpty": {
                        "$map": {
                          "from": {
                            "$ref": "request.videos"
                          },
                          "as": "media",
                          "in": {
                            "fileId": {
                              "$ref": "media.uploadId"
                            },
                            "name": {
                              "$concat": [
                                "Video",
                                {
                                  "$add": [
                                    {
                                      "$ref": "mediaIndex"
                                    },
                                    1
                                  ]
                                }
                              ]
                            }
                          }
                        }
                      }
                    },
                    "inputAudios": {
                      "$omitEmpty": {
                        "$map": {
                          "from": {
                            "$ref": "request.audios"
                          },
                          "as": "media",
                          "in": {
                            "fileId": {
                              "$ref": "media.uploadId"
                            },
                            "name": {
                              "$concat": [
                                "Audio",
                                {
                                  "$add": [
                                    {
                                      "$ref": "mediaIndex"
                                    },
                                    1
                                  ]
                                }
                              ]
                            }
                          }
                        }
                      }
                    },
                    "aspectRatio": {
                      "$omitEmpty": {
                        "$coalesce": [
                          {
                            "$ref": "request.providerOptions.topview-video.aspectRatio"
                          },
                          {
                            "$ref": "request.aspectRatio"
                          }
                        ]
                      }
                    },
                    "resolution": {
                      "$coalesce": [
                        {
                          "$ref": "request.providerOptions.topview-video.resolution"
                        },
                        {
                          "$switch": {
                            "cases": [
                              {
                                "when": {
                                  "$in": [
                                    {
                                      "$lower": {
                                        "$trim": {
                                          "$ref": "request.resolution"
                                        }
                                      }
                                    },
                                    [
                                      "360p",
                                      "360"
                                    ]
                                  ]
                                },
                                "then": 360
                              },
                              {
                                "when": {
                                  "$in": [
                                    {
                                      "$lower": {
                                        "$trim": {
                                          "$ref": "request.resolution"
                                        }
                                      }
                                    },
                                    [
                                      "480p",
                                      "480"
                                    ]
                                  ]
                                },
                                "then": 480
                              },
                              {
                                "when": {
                                  "$in": [
                                    {
                                      "$lower": {
                                        "$trim": {
                                          "$ref": "request.resolution"
                                        }
                                      }
                                    },
                                    [
                                      "540p",
                                      "540"
                                    ]
                                  ]
                                },
                                "then": 540
                              },
                              {
                                "when": {
                                  "$in": [
                                    {
                                      "$lower": {
                                        "$trim": {
                                          "$ref": "request.resolution"
                                        }
                                      }
                                    },
                                    [
                                      "720p",
                                      "720"
                                    ]
                                  ]
                                },
                                "then": 720
                              },
                              {
                                "when": {
                                  "$in": [
                                    {
                                      "$lower": {
                                        "$trim": {
                                          "$ref": "request.resolution"
                                        }
                                      }
                                    },
                                    [
                                      "768p",
                                      "768"
                                    ]
                                  ]
                                },
                                "then": 768
                              },
                              {
                                "when": {
                                  "$in": [
                                    {
                                      "$lower": {
                                        "$trim": {
                                          "$ref": "request.resolution"
                                        }
                                      }
                                    },
                                    [
                                      "1080p",
                                      "1080"
                                    ]
                                  ]
                                },
                                "then": 1080
                              },
                              {
                                "when": {
                                  "$in": [
                                    {
                                      "$lower": {
                                        "$trim": {
                                          "$ref": "request.resolution"
                                        }
                                      }
                                    },
                                    [
                                      "1440p",
                                      "1440",
                                      "2k"
                                    ]
                                  ]
                                },
                                "then": 1440
                              },
                              {
                                "when": {
                                  "$in": [
                                    {
                                      "$lower": {
                                        "$trim": {
                                          "$ref": "request.resolution"
                                        }
                                      }
                                    },
                                    [
                                      "2160p",
                                      "2160",
                                      "4k"
                                    ]
                                  ]
                                },
                                "then": 2160
                              }
                            ],
                            "default": null
                          }
                        }
                      ]
                    },
                    "duration": {
                      "$coalesce": [
                        {
                          "$ref": "request.providerOptions.topview-video.duration"
                        },
                        {
                          "$if": {
                            "condition": {
                              "$ne": [
                                {
                                  "$toInt": {
                                    "$ref": "request.duration"
                                  }
                                },
                                0
                              ]
                            },
                            "then": {
                              "$toInt": {
                                "$ref": "request.duration"
                              }
                            },
                            "else": null
                          }
                        }
                      ]
                    },
                    "generatingCount": {
                      "$coalesce": [
                        {
                          "$ref": "request.providerOptions.topview-video.generatingCount"
                        },
                        1
                      ]
                    },
                    "draftMode": {
                      "$omitEmpty": {
                        "$ref": "request.providerOptions.topview-video.draftMode"
                      }
                    },
                    "internetSearch": {
                      "$omitEmpty": {
                        "$ref": "request.providerOptions.topview-video.internetSearch"
                      }
                    }
                  }
                },
                {
                  "when": {
                    "$gt": [
                      {
                        "$len": {
                          "$ref": "request.images"
                        }
                      },
                      0
                    ]
                  },
                  "then": {
                    "model": {
                      "$if": {
                        "condition": {
                          "$eq": [
                            {
                              "$lower": {
                                "$trim": {
                                  "$ref": "request.model"
                                }
                              }
                            },
                            "kling-4.0"
                          ]
                        },
                        "then": "Kling 4.0",
                        "else": {
                          "$ref": "request.model"
                        }
                      }
                    },
                    "prompt": {
                      "$omitEmpty": {
                        "$ref": "request.prompt"
                      }
                    },
                    "firstFrameFileId": {
                      "$omitEmpty": {
                        "$first": {
                          "$map": {
                            "from": {
                              "$filter": {
                                "from": {
                                  "$sortByOrder": {
                                    "$ref": "request.images"
                                  }
                                },
                                "as": "media",
                                "where": {
                                  "$in": [
                                    {
                                      "$ref": "media.role"
                                    },
                                    [
                                      "first_frame",
                                      ""
                                    ]
                                  ]
                                }
                              }
                            },
                            "as": "media",
                            "in": {
                              "$ref": "media.uploadId"
                            }
                          }
                        }
                      }
                    },
                    "endFrameFileId": {
                      "$omitEmpty": {
                        "$first": {
                          "$map": {
                            "from": {
                              "$filter": {
                                "from": {
                                  "$sortByOrder": {
                                    "$ref": "request.images"
                                  }
                                },
                                "as": "media",
                                "where": {
                                  "$eq": [
                                    {
                                      "$ref": "media.role"
                                    },
                                    "last_frame"
                                  ]
                                }
                              }
                            },
                            "as": "media",
                            "in": {
                              "$ref": "media.uploadId"
                            }
                          }
                        }
                      }
                    },
                    "referenceImageFileIds": {
                      "$omitEmpty": {
                        "$map": {
                          "from": {
                            "$filter": {
                              "from": {
                                "$sortByOrder": {
                                  "$ref": "request.images"
                                }
                              },
                              "as": "media",
                              "where": {
                                "$eq": [
                                  {
                                    "$ref": "media.role"
                                  },
                                  "reference_image"
                                ]
                              }
                            }
                          },
                          "as": "media",
                          "in": {
                            "$ref": "media.uploadId"
                          }
                        }
                      }
                    },
                    "aspectRatio": {
                      "$omitEmpty": {
                        "$coalesce": [
                          {
                            "$ref": "request.providerOptions.topview-video.aspectRatio"
                          },
                          {
                            "$if": {
                              "condition": {
                                "$gt": [
                                  {
                                    "$len": {
                                      "$filter": {
                                        "from": {
                                          "$ref": "request.images"
                                        },
                                        "as": "media",
                                        "where": {
                                          "$in": [
                                            {
                                              "$ref": "media.role"
                                            },
                                            [
                                              "first_frame",
                                              "last_frame",
                                              ""
                                            ]
                                          ]
                                        }
                                      }
                                    }
                                  },
                                  0
                                ]
                              },
                              "then": null,
                              "else": {
                                "$ref": "request.aspectRatio"
                              }
                            }
                          }
                        ]
                      }
                    },
                    "resolution": {
                      "$coalesce": [
                        {
                          "$ref": "request.providerOptions.topview-video.resolution"
                        },
                        {
                          "$switch": {
                            "cases": [
                              {
                                "when": {
                                  "$in": [
                                    {
                                      "$lower": {
                                        "$trim": {
                                          "$ref": "request.resolution"
                                        }
                                      }
                                    },
                                    [
                                      "360p",
                                      "360"
                                    ]
                                  ]
                                },
                                "then": 360
                              },
                              {
                                "when": {
                                  "$in": [
                                    {
                                      "$lower": {
                                        "$trim": {
                                          "$ref": "request.resolution"
                                        }
                                      }
                                    },
                                    [
                                      "480p",
                                      "480"
                                    ]
                                  ]
                                },
                                "then": 480
                              },
                              {
                                "when": {
                                  "$in": [
                                    {
                                      "$lower": {
                                        "$trim": {
                                          "$ref": "request.resolution"
                                        }
                                      }
                                    },
                                    [
                                      "540p",
                                      "540"
                                    ]
                                  ]
                                },
                                "then": 540
                              },
                              {
                                "when": {
                                  "$in": [
                                    {
                                      "$lower": {
                                        "$trim": {
                                          "$ref": "request.resolution"
                                        }
                                      }
                                    },
                                    [
                                      "720p",
                                      "720"
                                    ]
                                  ]
                                },
                                "then": 720
                              },
                              {
                                "when": {
                                  "$in": [
                                    {
                                      "$lower": {
                                        "$trim": {
                                          "$ref": "request.resolution"
                                        }
                                      }
                                    },
                                    [
                                      "768p",
                                      "768"
                                    ]
                                  ]
                                },
                                "then": 768
                              },
                              {
                                "when": {
                                  "$in": [
                                    {
                                      "$lower": {
                                        "$trim": {
                                          "$ref": "request.resolution"
                                        }
                                      }
                                    },
                                    [
                                      "1080p",
                                      "1080"
                                    ]
                                  ]
                                },
                                "then": 1080
                              },
                              {
                                "when": {
                                  "$in": [
                                    {
                                      "$lower": {
                                        "$trim": {
                                          "$ref": "request.resolution"
                                        }
                                      }
                                    },
                                    [
                                      "1440p",
                                      "1440",
                                      "2k"
                                    ]
                                  ]
                                },
                                "then": 1440
                              },
                              {
                                "when": {
                                  "$in": [
                                    {
                                      "$lower": {
                                        "$trim": {
                                          "$ref": "request.resolution"
                                        }
                                      }
                                    },
                                    [
                                      "2160p",
                                      "2160",
                                      "4k"
                                    ]
                                  ]
                                },
                                "then": 2160
                              }
                            ],
                            "default": null
                          }
                        }
                      ]
                    },
                    "duration": {
                      "$coalesce": [
                        {
                          "$ref": "request.providerOptions.topview-video.duration"
                        },
                        {
                          "$if": {
                            "condition": {
                              "$ne": [
                                {
                                  "$toInt": {
                                    "$ref": "request.duration"
                                  }
                                },
                                0
                              ]
                            },
                            "then": {
                              "$toInt": {
                                "$ref": "request.duration"
                              }
                            },
                            "else": null
                          }
                        }
                      ]
                    },
                    "sound": {
                      "$switch": {
                        "cases": [
                          {
                            "when": {
                              "$eq": [
                                {
                                  "$ref": "request.generateAudio"
                                },
                                true
                              ]
                            },
                            "then": "on"
                          },
                          {
                            "when": {
                              "$eq": [
                                {
                                  "$ref": "request.generateAudio"
                                },
                                false
                              ]
                            },
                            "then": "off"
                          }
                        ],
                        "default": {
                          "$omitEmpty": {
                            "$ref": "request.providerOptions.topview-video.sound"
                          }
                        }
                      }
                    },
                    "generatingCount": {
                      "$coalesce": [
                        {
                          "$ref": "request.providerOptions.topview-video.generatingCount"
                        },
                        1
                      ]
                    },
                    "draftMode": {
                      "$omitEmpty": {
                        "$ref": "request.providerOptions.topview-video.draftMode"
                      }
                    }
                  }
                }
              ],
              "default": {
                "model": {
                  "$if": {
                    "condition": {
                      "$eq": [
                        {
                          "$lower": {
                            "$trim": {
                              "$ref": "request.model"
                            }
                          }
                        },
                        "kling-4.0"
                      ]
                    },
                    "then": "Kling 4.0",
                    "else": {
                      "$ref": "request.model"
                    }
                  }
                },
                "prompt": {
                  "$ref": "request.prompt"
                },
                "aspectRatio": {
                  "$omitEmpty": {
                    "$coalesce": [
                      {
                        "$ref": "request.providerOptions.topview-video.aspectRatio"
                      },
                      {
                        "$ref": "request.aspectRatio"
                      }
                    ]
                  }
                },
                "resolution": {
                  "$coalesce": [
                    {
                      "$ref": "request.providerOptions.topview-video.resolution"
                    },
                    {
                      "$switch": {
                        "cases": [
                          {
                            "when": {
                              "$in": [
                                {
                                  "$lower": {
                                    "$trim": {
                                      "$ref": "request.resolution"
                                    }
                                  }
                                },
                                [
                                  "360p",
                                  "360"
                                ]
                              ]
                            },
                            "then": 360
                          },
                          {
                            "when": {
                              "$in": [
                                {
                                  "$lower": {
                                    "$trim": {
                                      "$ref": "request.resolution"
                                    }
                                  }
                                },
                                [
                                  "480p",
                                  "480"
                                ]
                              ]
                            },
                            "then": 480
                          },
                          {
                            "when": {
                              "$in": [
                                {
                                  "$lower": {
                                    "$trim": {
                                      "$ref": "request.resolution"
                                    }
                                  }
                                },
                                [
                                  "540p",
                                  "540"
                                ]
                              ]
                            },
                            "then": 540
                          },
                          {
                            "when": {
                              "$in": [
                                {
                                  "$lower": {
                                    "$trim": {
                                      "$ref": "request.resolution"
                                    }
                                  }
                                },
                                [
                                  "720p",
                                  "720"
                                ]
                              ]
                            },
                            "then": 720
                          },
                          {
                            "when": {
                              "$in": [
                                {
                                  "$lower": {
                                    "$trim": {
                                      "$ref": "request.resolution"
                                    }
                                  }
                                },
                                [
                                  "768p",
                                  "768"
                                ]
                              ]
                            },
                            "then": 768
                          },
                          {
                            "when": {
                              "$in": [
                                {
                                  "$lower": {
                                    "$trim": {
                                      "$ref": "request.resolution"
                                    }
                                  }
                                },
                                [
                                  "1080p",
                                  "1080"
                                ]
                              ]
                            },
                            "then": 1080
                          },
                          {
                            "when": {
                              "$in": [
                                {
                                  "$lower": {
                                    "$trim": {
                                      "$ref": "request.resolution"
                                    }
                                  }
                                },
                                [
                                  "1440p",
                                  "1440",
                                  "2k"
                                ]
                              ]
                            },
                            "then": 1440
                          },
                          {
                            "when": {
                              "$in": [
                                {
                                  "$lower": {
                                    "$trim": {
                                      "$ref": "request.resolution"
                                    }
                                  }
                                },
                                [
                                  "2160p",
                                  "2160",
                                  "4k"
                                ]
                              ]
                            },
                            "then": 2160
                          }
                        ],
                        "default": null
                      }
                    }
                  ]
                },
                "duration": {
                  "$coalesce": [
                    {
                      "$ref": "request.providerOptions.topview-video.duration"
                    },
                    {
                      "$if": {
                        "condition": {
                          "$ne": [
                            {
                              "$toInt": {
                                "$ref": "request.duration"
                              }
                            },
                            0
                          ]
                        },
                        "then": {
                          "$toInt": {
                            "$ref": "request.duration"
                          }
                        },
                        "else": null
                      }
                    }
                  ]
                },
                "sound": {
                  "$switch": {
                    "cases": [
                      {
                        "when": {
                          "$eq": [
                            {
                              "$ref": "request.generateAudio"
                            },
                            true
                          ]
                        },
                        "then": "on"
                      },
                      {
                        "when": {
                          "$eq": [
                            {
                              "$ref": "request.generateAudio"
                            },
                            false
                          ]
                        },
                        "then": "off"
                      }
                    ],
                    "default": {
                      "$omitEmpty": {
                        "$ref": "request.providerOptions.topview-video.sound"
                      }
                    }
                  }
                },
                "generatingCount": {
                  "$coalesce": [
                    {
                      "$ref": "request.providerOptions.topview-video.generatingCount"
                    },
                    1
                  ]
                },
                "draftMode": {
                  "$omitEmpty": {
                    "$ref": "request.providerOptions.topview-video.draftMode"
                  }
                }
              }
            }
          }
        },
        "upload": {
          "kinds": [
            "image",
            "video",
            "audio"
          ],
          "method": "GET",
          "path": "/v1/upload/credential",
          "query": {
            "format": {
              "$switch": {
                "cases": [
                  {
                    "when": {
                      "$in": [
                        {
                          "$lower": {
                            "$trim": {
                              "$ref": "media.mimeType"
                            }
                          }
                        },
                        [
                          "image/png"
                        ]
                      ]
                    },
                    "then": "png"
                  },
                  {
                    "when": {
                      "$in": [
                        {
                          "$lower": {
                            "$trim": {
                              "$ref": "media.mimeType"
                            }
                          }
                        },
                        [
                          "image/jpeg",
                          "image/jpg",
                          "image/pjpeg"
                        ]
                      ]
                    },
                    "then": "jpg"
                  },
                  {
                    "when": {
                      "$in": [
                        {
                          "$lower": {
                            "$trim": {
                              "$ref": "media.mimeType"
                            }
                          }
                        },
                        [
                          "image/webp"
                        ]
                      ]
                    },
                    "then": "webp"
                  },
                  {
                    "when": {
                      "$in": [
                        {
                          "$lower": {
                            "$trim": {
                              "$ref": "media.mimeType"
                            }
                          }
                        },
                        [
                          "image/bmp",
                          "image/x-ms-bmp"
                        ]
                      ]
                    },
                    "then": "bmp"
                  },
                  {
                    "when": {
                      "$in": [
                        {
                          "$lower": {
                            "$trim": {
                              "$ref": "media.mimeType"
                            }
                          }
                        },
                        [
                          "video/mp4",
                          "video/x-m4v"
                        ]
                      ]
                    },
                    "then": "mp4"
                  },
                  {
                    "when": {
                      "$in": [
                        {
                          "$lower": {
                            "$trim": {
                              "$ref": "media.mimeType"
                            }
                          }
                        },
                        [
                          "video/quicktime"
                        ]
                      ]
                    },
                    "then": "mov"
                  },
                  {
                    "when": {
                      "$in": [
                        {
                          "$lower": {
                            "$trim": {
                              "$ref": "media.mimeType"
                            }
                          }
                        },
                        [
                          "video/x-msvideo",
                          "video/avi",
                          "video/msvideo"
                        ]
                      ]
                    },
                    "then": "avi"
                  },
                  {
                    "when": {
                      "$in": [
                        {
                          "$lower": {
                            "$trim": {
                              "$ref": "media.mimeType"
                            }
                          }
                        },
                        [
                          "audio/mpeg",
                          "audio/mp3",
                          "audio/mpeg3",
                          "audio/x-mpeg-3"
                        ]
                      ]
                    },
                    "then": "mp3"
                  },
                  {
                    "when": {
                      "$in": [
                        {
                          "$lower": {
                            "$trim": {
                              "$ref": "media.mimeType"
                            }
                          }
                        },
                        [
                          "audio/wav",
                          "audio/x-wav",
                          "audio/wave",
                          "audio/vnd.wave"
                        ]
                      ]
                    },
                    "then": "wav"
                  },
                  {
                    "when": {
                      "$in": [
                        {
                          "$lower": {
                            "$trim": {
                              "$ref": "media.mimeType"
                            }
                          }
                        },
                        [
                          "audio/mp4",
                          "audio/x-m4a",
                          "audio/m4a"
                        ]
                      ]
                    },
                    "then": "m4a"
                  },
                  {
                    "when": {
                      "$eq": [
                        {
                          "$ref": "media.kind"
                        },
                        "video"
                      ]
                    },
                    "then": "mp4"
                  },
                  {
                    "when": {
                      "$eq": [
                        {
                          "$ref": "media.kind"
                        },
                        "audio"
                      ]
                    },
                    "then": "mp3"
                  }
                ],
                "default": "png"
              }
            }
          },
          "id": {
            "$ref": "response.result.fileId"
          },
          "message": {
            "$if": {
              "condition": {
                "$and": [
                  {
                    "$ne": [
                      {
                        "$toString": {
                          "$ref": "response.code"
                        }
                      },
                      ""
                    ]
                  },
                  {
                    "$ne": [
                      {
                        "$toString": {
                          "$ref": "response.code"
                        }
                      },
                      "200"
                    ]
                  }
                ]
              },
              "then": {
                "$concat": [
                  "TopView 返回错误（code ",
                  {
                    "$toString": {
                      "$ref": "response.code"
                    }
                  },
                  "）：",
                  {
                    "$coalesce": [
                      {
                        "$ref": "response.message"
                      },
                      "未知错误"
                    ]
                  }
                ]
              },
              "else": null
            }
          },
          "transfer": {
            "method": "PUT",
            "url": {
              "$ref": "response.result.uploadUrl"
            }
          },
          "confirm": {
            "method": "GET",
            "path": "/v1/upload/check",
            "query": {
              "fileId": {
                "$ref": "upload.id"
              }
            },
            "assert": {
              "$and": [
                {
                  "$eq": [
                    {
                      "$toString": {
                        "$ref": "response.code"
                      }
                    },
                    "200"
                  ]
                },
                {
                  "$eq": [
                    {
                      "$lower": {
                        "$toString": {
                          "$ref": "response.result"
                        }
                      }
                    },
                    "true"
                  ]
                }
              ]
            },
            "message": {
              "$concat": [
                "TopView 素材校验未通过（code ",
                {
                  "$toString": {
                    "$ref": "response.code"
                  }
                },
                "）：",
                {
                  "$coalesce": [
                    {
                      "$ref": "response.message"
                    },
                    "未知错误"
                  ]
                }
              ]
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/common_task/text2video/task/query",
          "pathTemplate": {
            "$switch": {
              "cases": [
                {
                  "when": {
                    "$eq": [
                      {
                        "$first": {
                          "$split": [
                            {
                              "$ref": "taskId"
                            },
                            ":"
                          ]
                        }
                      },
                      "omni"
                    ]
                  },
                  "then": "/v1/common_task/omni_reference/task/query"
                },
                {
                  "when": {
                    "$eq": [
                      {
                        "$first": {
                          "$split": [
                            {
                              "$ref": "taskId"
                            },
                            ":"
                          ]
                        }
                      },
                      "i2v"
                    ]
                  },
                  "then": "/v2/common_task/image2video/task/query"
                }
              ],
              "default": "/v1/common_task/text2video/task/query"
            }
          },
          "query": {
            "taskId": {
              "$last": {
                "$split": [
                  {
                    "$ref": "taskId"
                  },
                  ":"
                ]
              }
            }
          }
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "taskId"
              },
              {
                "$if": {
                  "condition": {
                    "$ne": [
                      {
                        "$trim": {
                          "$toString": {
                            "$ref": "response.result.taskId"
                          }
                        }
                      },
                      ""
                    ]
                  },
                  "then": {
                    "$concat": [
                      {
                        "$switch": {
                          "cases": [
                            {
                              "when": {
                                "$or": [
                                  {
                                    "$gt": [
                                      {
                                        "$add": [
                                          {
                                            "$len": {
                                              "$ref": "request.videos"
                                            }
                                          },
                                          {
                                            "$len": {
                                              "$ref": "request.audios"
                                            }
                                          }
                                        ]
                                      },
                                      0
                                    ]
                                  },
                                  {
                                    "$and": [
                                      {
                                        "$gt": [
                                          {
                                            "$len": {
                                              "$ref": "request.images"
                                            }
                                          },
                                          0
                                        ]
                                      },
                                      {
                                        "$not": {
                                          "$gt": [
                                            {
                                              "$len": {
                                                "$filter": {
                                                  "from": {
                                                    "$ref": "request.images"
                                                  },
                                                  "as": "media",
                                                  "where": {
                                                    "$in": [
                                                      {
                                                        "$ref": "media.role"
                                                      },
                                                      [
                                                        "first_frame",
                                                        "last_frame",
                                                        ""
                                                      ]
                                                    ]
                                                  }
                                                }
                                              }
                                            },
                                            0
                                          ]
                                        }
                                      },
                                      {
                                        "$not": {
                                          "$switch": {
                                            "cases": [
                                              {
                                                "when": {
                                                  "$eq": [
                                                    {
                                                      "$lower": {
                                                        "$trim": {
                                                          "$ref": "request.providerOptions.topview-video.imageMode"
                                                        }
                                                      }
                                                    },
                                                    "omni"
                                                  ]
                                                },
                                                "then": false
                                              },
                                              {
                                                "when": {
                                                  "$eq": [
                                                    {
                                                      "$lower": {
                                                        "$trim": {
                                                          "$ref": "request.providerOptions.topview-video.imageMode"
                                                        }
                                                      }
                                                    },
                                                    "image2video"
                                                  ]
                                                },
                                                "then": true
                                              }
                                            ],
                                            "default": {
                                              "$or": [
                                                {
                                                  "$gt": [
                                                    {
                                                      "$len": {
                                                        "$split": [
                                                          {
                                                            "$lower": {
                                                              "$ref": "request.model"
                                                            }
                                                          },
                                                          "reference"
                                                        ]
                                                      }
                                                    },
                                                    1
                                                  ]
                                                },
                                                {
                                                  "$eq": [
                                                    {
                                                      "$lower": {
                                                        "$trim": {
                                                          "$ref": "request.model"
                                                        }
                                                      }
                                                    },
                                                    "gemini omni flash"
                                                  ]
                                                }
                                              ]
                                            }
                                          }
                                        }
                                      }
                                    ]
                                  }
                                ]
                              },
                              "then": "omni"
                            },
                            {
                              "when": {
                                "$gt": [
                                  {
                                    "$len": {
                                      "$ref": "request.images"
                                    }
                                  },
                                  0
                                ]
                              },
                              "then": "i2v"
                            }
                          ],
                          "default": "t2v"
                        }
                      },
                      ":",
                      {
                        "$ref": "response.result.taskId"
                      }
                    ]
                  },
                  "else": null
                }
              }
            ]
          },
          "status": {
            "$if": {
              "condition": {
                "$and": [
                  {
                    "$ne": [
                      {
                        "$toString": {
                          "$ref": "response.code"
                        }
                      },
                      ""
                    ]
                  },
                  {
                    "$ne": [
                      {
                        "$toString": {
                          "$ref": "response.code"
                        }
                      },
                      "200"
                    ]
                  }
                ]
              },
              "then": "failed",
              "else": {
                "$switch": {
                  "cases": [
                    {
                      "when": {
                        "$eq": [
                          {
                            "$lower": {
                              "$trim": {
                                "$ref": "response.result.status"
                              }
                            }
                          },
                          "success"
                        ]
                      },
                      "then": {
                        "$if": {
                          "condition": {
                            "$gt": [
                              {
                                "$len": {
                                  "$filter": {
                                    "from": {
                                      "$map": {
                                        "from": {
                                          "$ref": "response.result.videos"
                                        },
                                        "as": "item",
                                        "in": {
                                          "$ref": "item.filePath"
                                        }
                                      }
                                    },
                                    "as": "url",
                                    "where": {
                                      "$ne": [
                                        {
                                          "$trim": {
                                            "$ref": "url"
                                          }
                                        },
                                        ""
                                      ]
                                    }
                                  }
                                }
                              },
                              0
                            ]
                          },
                          "then": "succeeded",
                          "else": {
                            "$if": {
                              "condition": {
                                "$eq": [
                                  {
                                    "$trim": {
                                      "$ref": "taskId"
                                    }
                                  },
                                  ""
                                ]
                              },
                              "then": "pending",
                              "else": "failed"
                            }
                          }
                        }
                      }
                    },
                    {
                      "when": {
                        "$in": [
                          {
                            "$lower": {
                              "$trim": {
                                "$ref": "response.result.status"
                              }
                            }
                          },
                          [
                            "fail",
                            "failed",
                            "failure",
                            "error"
                          ]
                        ]
                      },
                      "then": "failed"
                    },
                    {
                      "when": {
                        "$eq": [
                          {
                            "$lower": {
                              "$trim": {
                                "$ref": "response.result.status"
                              }
                            }
                          },
                          "running"
                        ]
                      },
                      "then": "processing"
                    },
                    {
                      "when": {
                        "$eq": [
                          {
                            "$lower": {
                              "$trim": {
                                "$ref": "response.result.status"
                              }
                            }
                          },
                          "init"
                        ]
                      },
                      "then": "pending"
                    }
                  ],
                  "default": {
                    "$coalesce": [
                      {
                        "$ref": "response.result.status"
                      },
                      "pending"
                    ]
                  }
                }
              }
            }
          },
          "message": {
            "$coalesce": [
              {
                "$if": {
                  "condition": {
                    "$and": [
                      {
                        "$ne": [
                          {
                            "$toString": {
                              "$ref": "response.code"
                            }
                          },
                          ""
                        ]
                      },
                      {
                        "$ne": [
                          {
                            "$toString": {
                              "$ref": "response.code"
                            }
                          },
                          "200"
                        ]
                      }
                    ]
                  },
                  "then": {
                    "$concat": [
                      "TopView 返回错误（code ",
                      {
                        "$toString": {
                          "$ref": "response.code"
                        }
                      },
                      "）：",
                      {
                        "$coalesce": [
                          {
                            "$ref": "response.message"
                          },
                          "未知错误"
                        ]
                      }
                    ]
                  },
                  "else": null
                }
              },
              {
                "$ref": "response.result.errorMsg"
              },
              {
                "$first": {
                  "$filter": {
                    "from": {
                      "$map": {
                        "from": {
                          "$ref": "response.result.videos"
                        },
                        "as": "item",
                        "in": {
                          "$ref": "item.errorMsg"
                        }
                      }
                    },
                    "as": "text",
                    "where": {
                      "$ne": [
                        {
                          "$trim": {
                            "$ref": "text"
                          }
                        },
                        ""
                      ]
                    }
                  }
                }
              },
              {
                "$if": {
                  "condition": {
                    "$and": [
                      {
                        "$eq": [
                          {
                            "$lower": {
                              "$trim": {
                                "$ref": "response.result.status"
                              }
                            }
                          },
                          "success"
                        ]
                      },
                      {
                        "$eq": [
                          {
                            "$len": {
                              "$filter": {
                                "from": {
                                  "$map": {
                                    "from": {
                                      "$ref": "response.result.videos"
                                    },
                                    "as": "item",
                                    "in": {
                                      "$ref": "item.filePath"
                                    }
                                  }
                                },
                                "as": "url",
                                "where": {
                                  "$ne": [
                                    {
                                      "$trim": {
                                        "$ref": "url"
                                      }
                                    },
                                    ""
                                  ]
                                }
                              }
                            }
                          },
                          0
                        ]
                      },
                      {
                        "$ne": [
                          {
                            "$trim": {
                              "$ref": "taskId"
                            }
                          },
                          ""
                        ]
                      }
                    ]
                  },
                  "then": "TopView 任务已结束，但没有返回可用的视频文件",
                  "else": null
                }
              }
            ]
          },
          "videos": {
            "$filter": {
              "from": {
                "$map": {
                  "from": {
                    "$ref": "response.result.videos"
                  },
                  "as": "item",
                  "in": {
                    "$ref": "item.filePath"
                  }
                }
              },
              "as": "url",
              "where": {
                "$ne": [
                  {
                    "$trim": {
                      "$ref": "url"
                    }
                  },
                  ""
                ]
              }
            }
          },
          "resultEphemeral": true
        }
      },
      {
        "id": "topview-image",
        "label": "TopView 图片（文生图）",
        "capabilities": [
          "image"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://api.topview.ai",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "imageParameters": [
          {
            "name": "ratio",
            "label": "画幅比例",
            "type": "string",
            "binding": "aspectRatio",
            "values": [
              "1:1",
              "16:9",
              "9:16",
              "4:3",
              "3:4",
              "3:2",
              "2:3",
              "5:4",
              "4:5",
              "21:9"
            ],
            "default": "1:1"
          },
          {
            "name": "imageResolution",
            "label": "分辨率",
            "type": "string",
            "binding": "resolution",
            "values": [
              "1K",
              "2K",
              "4K",
              "512p"
            ],
            "default": "2K"
          },
          {
            "name": "count",
            "label": "生成数量",
            "type": "integer",
            "binding": "imageCount",
            "min": 1,
            "max": 4,
            "step": 1,
            "default": 1
          }
        ],
        "parameters": [
          {
            "name": "model",
            "type": "string",
            "required": true,
            "mapping": "model",
            "description": "TopView 图片模型显示名，例如 Nano Banana Pro、Seedream 4.5、GPT Image 2。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "图片提示词。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "unsupported",
            "description": "当前版本不支持参考图或图片编辑，传入时插件直接返回错误。"
          },
          {
            "name": "imageCount",
            "type": "integer",
            "required": false,
            "mapping": "generateCount",
            "description": "输出数量 1-4，未设置时为 1。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "aspectRatio",
            "description": "画幅比例，例如 1:1、16:9、9:16。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution",
            "description": "分辨率档位 1K、2K、4K、512p，未设置时为 2K；Nano Banana 与 Kontext-Pro 不传。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "required": false,
            "mapping": "provider-specific fields",
            "description": "插件命名空间内的厂商扩展字段，例如 quality、resolution。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$ref": "request.images"
                  }
                },
                0
              ]
            },
            "message": "TopView 图片协议当前只支持文生图，暂不支持参考图或图片编辑"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$toInt": {
                    "$ref": "request.imageCount"
                  }
                },
                4
              ]
            },
            "message": "TopView 单次最多生成 4 张图片"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/common_task/text2image/task/submit",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "aspectRatio": {
              "$omitEmpty": {
                "$coalesce": [
                  {
                    "$ref": "request.aspectRatio"
                  },
                  {
                    "$ref": "request.providerOptions.topview-image.aspectRatio"
                  }
                ]
              }
            },
            "resolution": {
              "$if": {
                "condition": {
                  "$in": [
                    {
                      "$trim": {
                        "$ref": "request.model"
                      }
                    },
                    [
                      "Nano Banana",
                      "Kontext-Pro"
                    ]
                  ]
                },
                "then": null,
                "else": {
                  "$coalesce": [
                    {
                      "$ref": "request.providerOptions.topview-image.resolution"
                    },
                    {
                      "$switch": {
                        "cases": [
                          {
                            "when": {
                              "$eq": [
                                {
                                  "$lower": {
                                    "$trim": {
                                      "$ref": "request.resolution"
                                    }
                                  }
                                },
                                "512p"
                              ]
                            },
                            "then": "512p"
                          },
                          {
                            "when": {
                              "$eq": [
                                {
                                  "$lower": {
                                    "$trim": {
                                      "$ref": "request.resolution"
                                    }
                                  }
                                },
                                "1k"
                              ]
                            },
                            "then": "1K"
                          },
                          {
                            "when": {
                              "$eq": [
                                {
                                  "$lower": {
                                    "$trim": {
                                      "$ref": "request.resolution"
                                    }
                                  }
                                },
                                "2k"
                              ]
                            },
                            "then": "2K"
                          },
                          {
                            "when": {
                              "$eq": [
                                {
                                  "$lower": {
                                    "$trim": {
                                      "$ref": "request.resolution"
                                    }
                                  }
                                },
                                "4k"
                              ]
                            },
                            "then": "4K"
                          }
                        ],
                        "default": null
                      }
                    },
                    "2K"
                  ]
                }
              }
            },
            "generateCount": {
              "$max": [
                {
                  "$toInt": {
                    "$ref": "request.imageCount"
                  }
                },
                1
              ]
            },
            "quality": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.topview-image.quality"
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/common_task/text2image/task/query",
          "query": {
            "taskId": {
              "$ref": "taskId"
            }
          }
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.result.taskId"
              },
              {
                "$ref": "taskId"
              }
            ]
          },
          "status": {
            "$if": {
              "condition": {
                "$and": [
                  {
                    "$ne": [
                      {
                        "$toString": {
                          "$ref": "response.code"
                        }
                      },
                      ""
                    ]
                  },
                  {
                    "$ne": [
                      {
                        "$toString": {
                          "$ref": "response.code"
                        }
                      },
                      "200"
                    ]
                  }
                ]
              },
              "then": "failed",
              "else": {
                "$switch": {
                  "cases": [
                    {
                      "when": {
                        "$eq": [
                          {
                            "$lower": {
                              "$trim": {
                                "$ref": "response.result.status"
                              }
                            }
                          },
                          "success"
                        ]
                      },
                      "then": {
                        "$if": {
                          "condition": {
                            "$gt": [
                              {
                                "$len": {
                                  "$filter": {
                                    "from": {
                                      "$map": {
                                        "from": {
                                          "$ref": "response.result.images"
                                        },
                                        "as": "item",
                                        "in": {
                                          "$ref": "item.filePath"
                                        }
                                      }
                                    },
                                    "as": "url",
                                    "where": {
                                      "$ne": [
                                        {
                                          "$trim": {
                                            "$ref": "url"
                                          }
                                        },
                                        ""
                                      ]
                                    }
                                  }
                                }
                              },
                              0
                            ]
                          },
                          "then": "succeeded",
                          "else": {
                            "$if": {
                              "condition": {
                                "$eq": [
                                  {
                                    "$trim": {
                                      "$ref": "taskId"
                                    }
                                  },
                                  ""
                                ]
                              },
                              "then": "pending",
                              "else": "failed"
                            }
                          }
                        }
                      }
                    },
                    {
                      "when": {
                        "$in": [
                          {
                            "$lower": {
                              "$trim": {
                                "$ref": "response.result.status"
                              }
                            }
                          },
                          [
                            "fail",
                            "failed",
                            "failure",
                            "error"
                          ]
                        ]
                      },
                      "then": "failed"
                    },
                    {
                      "when": {
                        "$eq": [
                          {
                            "$lower": {
                              "$trim": {
                                "$ref": "response.result.status"
                              }
                            }
                          },
                          "running"
                        ]
                      },
                      "then": "processing"
                    },
                    {
                      "when": {
                        "$eq": [
                          {
                            "$lower": {
                              "$trim": {
                                "$ref": "response.result.status"
                              }
                            }
                          },
                          "init"
                        ]
                      },
                      "then": "pending"
                    }
                  ],
                  "default": {
                    "$coalesce": [
                      {
                        "$ref": "response.result.status"
                      },
                      "pending"
                    ]
                  }
                }
              }
            }
          },
          "message": {
            "$coalesce": [
              {
                "$if": {
                  "condition": {
                    "$and": [
                      {
                        "$ne": [
                          {
                            "$toString": {
                              "$ref": "response.code"
                            }
                          },
                          ""
                        ]
                      },
                      {
                        "$ne": [
                          {
                            "$toString": {
                              "$ref": "response.code"
                            }
                          },
                          "200"
                        ]
                      }
                    ]
                  },
                  "then": {
                    "$concat": [
                      "TopView 返回错误（code ",
                      {
                        "$toString": {
                          "$ref": "response.code"
                        }
                      },
                      "）：",
                      {
                        "$coalesce": [
                          {
                            "$ref": "response.message"
                          },
                          "未知错误"
                        ]
                      }
                    ]
                  },
                  "else": null
                }
              },
              {
                "$ref": "response.result.errorMsg"
              },
              {
                "$first": {
                  "$filter": {
                    "from": {
                      "$map": {
                        "from": {
                          "$ref": "response.result.images"
                        },
                        "as": "item",
                        "in": {
                          "$ref": "item.errorMsg"
                        }
                      }
                    },
                    "as": "text",
                    "where": {
                      "$ne": [
                        {
                          "$trim": {
                            "$ref": "text"
                          }
                        },
                        ""
                      ]
                    }
                  }
                }
              },
              {
                "$if": {
                  "condition": {
                    "$and": [
                      {
                        "$eq": [
                          {
                            "$lower": {
                              "$trim": {
                                "$ref": "response.result.status"
                              }
                            }
                          },
                          "success"
                        ]
                      },
                      {
                        "$eq": [
                          {
                            "$len": {
                              "$filter": {
                                "from": {
                                  "$map": {
                                    "from": {
                                      "$ref": "response.result.images"
                                    },
                                    "as": "item",
                                    "in": {
                                      "$ref": "item.filePath"
                                    }
                                  }
                                },
                                "as": "url",
                                "where": {
                                  "$ne": [
                                    {
                                      "$trim": {
                                        "$ref": "url"
                                      }
                                    },
                                    ""
                                  ]
                                }
                              }
                            }
                          },
                          0
                        ]
                      },
                      {
                        "$ne": [
                          {
                            "$trim": {
                              "$ref": "taskId"
                            }
                          },
                          ""
                        ]
                      }
                    ]
                  },
                  "then": "TopView 任务已结束，但没有返回可用的图片文件",
                  "else": null
                }
              }
            ]
          },
          "images": {
            "$filter": {
              "from": {
                "$map": {
                  "from": {
                    "$ref": "response.result.images"
                  },
                  "as": "item",
                  "in": {
                    "$ref": "item.filePath"
                  }
                }
              },
              "as": "url",
              "where": {
                "$ne": [
                  {
                    "$trim": {
                      "$ref": "url"
                    }
                  },
                  ""
                ]
              }
            }
          },
          "resultEphemeral": true
        }
      },
      {
        "id": "topview-tts",
        "label": "TopView 配音（文字转语音）",
        "capabilities": [
          "audio"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://api.topview.ai",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "parameters": [
          {
            "name": "model",
            "type": "string",
            "required": true,
            "mapping": "voiceModel",
            "description": "值为 minimax-v2.5、elevenlabs-v2.5、elevenlabs-v3、elevenlabs-v4 之一时作为 voiceModel 发送；其他值不发送，使用 TopView 默认配音模型。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "voiceText",
            "description": "待合成文本，可使用 TopView 的 break 停顿标签。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "required": false,
            "mapping": "provider-specific fields",
            "description": "插件命名空间内的厂商扩展字段，例如 voiceId、voiceSpeed、voiceModel、emotionName。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/voice/text2voice/task/submit",
          "contentType": "application/json",
          "body": {
            "voiceId": {
              "$coalesce": [
                {
                  "$if": {
                    "condition": {
                      "$gte": [
                        {
                          "$len": {
                            "$trim": {
                              "$ref": "request.extra.audioVoice"
                            }
                          }
                        },
                        16
                      ]
                    },
                    "then": {
                      "$trim": {
                        "$ref": "request.extra.audioVoice"
                      }
                    },
                    "else": null
                  }
                },
                {
                  "$ref": "request.providerOptions.topview-tts.voiceId"
                },
                "6365baea832941c8842db62a87a3e98e"
              ]
            },
            "voiceText": {
              "$ref": "request.prompt"
            },
            "voiceSpeed": {
              "$coalesce": [
                {
                  "$if": {
                    "condition": {
                      "$gt": [
                        {
                          "$toFloat": {
                            "$ref": "request.extra.audioSpeed"
                          }
                        },
                        0
                      ]
                    },
                    "then": {
                      "$min": [
                        {
                          "$max": [
                            {
                              "$toFloat": {
                                "$ref": "request.extra.audioSpeed"
                              }
                            },
                            0.8
                          ]
                        },
                        1.2
                      ]
                    },
                    "else": null
                  }
                },
                {
                  "$ref": "request.providerOptions.topview-tts.voiceSpeed"
                },
                1
              ]
            },
            "voiceModel": {
              "$coalesce": [
                {
                  "$if": {
                    "condition": {
                      "$in": [
                        {
                          "$lower": {
                            "$trim": {
                              "$ref": "request.model"
                            }
                          }
                        },
                        [
                          "minimax-v2.5",
                          "elevenlabs-v2.5",
                          "elevenlabs-v3",
                          "elevenlabs-v4"
                        ]
                      ]
                    },
                    "then": {
                      "$lower": {
                        "$trim": {
                          "$ref": "request.model"
                        }
                      }
                    },
                    "else": null
                  }
                },
                {
                  "$ref": "request.providerOptions.topview-tts.voiceModel"
                }
              ]
            },
            "emotionName": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.topview-tts.emotionName"
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/voice/text2voice/task/query",
          "query": {
            "taskId": {
              "$ref": "taskId"
            }
          }
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.result.taskId"
              },
              {
                "$ref": "taskId"
              }
            ]
          },
          "status": {
            "$if": {
              "condition": {
                "$and": [
                  {
                    "$ne": [
                      {
                        "$toString": {
                          "$ref": "response.code"
                        }
                      },
                      ""
                    ]
                  },
                  {
                    "$ne": [
                      {
                        "$toString": {
                          "$ref": "response.code"
                        }
                      },
                      "200"
                    ]
                  }
                ]
              },
              "then": "failed",
              "else": {
                "$switch": {
                  "cases": [
                    {
                      "when": {
                        "$eq": [
                          {
                            "$lower": {
                              "$trim": {
                                "$ref": "response.result.status"
                              }
                            }
                          },
                          "success"
                        ]
                      },
                      "then": {
                        "$if": {
                          "condition": {
                            "$gt": [
                              {
                                "$len": {
                                  "$trim": {
                                    "$coalesce": [
                                      {
                                        "$ref": "response.result.voice.demoAudioUrl"
                                      },
                                      {
                                        "$ref": "response.result.voice.audioUrl"
                                      },
                                      {
                                        "$ref": "response.result.audioUrl"
                                      },
                                      {
                                        "$ref": "response.result.filePath"
                                      }
                                    ]
                                  }
                                }
                              },
                              0
                            ]
                          },
                          "then": "succeeded",
                          "else": {
                            "$if": {
                              "condition": {
                                "$eq": [
                                  {
                                    "$trim": {
                                      "$ref": "taskId"
                                    }
                                  },
                                  ""
                                ]
                              },
                              "then": "pending",
                              "else": "failed"
                            }
                          }
                        }
                      }
                    },
                    {
                      "when": {
                        "$in": [
                          {
                            "$lower": {
                              "$trim": {
                                "$ref": "response.result.status"
                              }
                            }
                          },
                          [
                            "fail",
                            "failed",
                            "failure",
                            "error"
                          ]
                        ]
                      },
                      "then": "failed"
                    },
                    {
                      "when": {
                        "$eq": [
                          {
                            "$lower": {
                              "$trim": {
                                "$ref": "response.result.status"
                              }
                            }
                          },
                          "running"
                        ]
                      },
                      "then": "processing"
                    },
                    {
                      "when": {
                        "$eq": [
                          {
                            "$lower": {
                              "$trim": {
                                "$ref": "response.result.status"
                              }
                            }
                          },
                          "init"
                        ]
                      },
                      "then": "pending"
                    }
                  ],
                  "default": {
                    "$coalesce": [
                      {
                        "$ref": "response.result.status"
                      },
                      "pending"
                    ]
                  }
                }
              }
            }
          },
          "message": {
            "$coalesce": [
              {
                "$if": {
                  "condition": {
                    "$and": [
                      {
                        "$ne": [
                          {
                            "$toString": {
                              "$ref": "response.code"
                            }
                          },
                          ""
                        ]
                      },
                      {
                        "$ne": [
                          {
                            "$toString": {
                              "$ref": "response.code"
                            }
                          },
                          "200"
                        ]
                      }
                    ]
                  },
                  "then": {
                    "$concat": [
                      "TopView 返回错误（code ",
                      {
                        "$toString": {
                          "$ref": "response.code"
                        }
                      },
                      "）：",
                      {
                        "$coalesce": [
                          {
                            "$ref": "response.message"
                          },
                          "未知错误"
                        ]
                      }
                    ]
                  },
                  "else": null
                }
              },
              {
                "$ref": "response.result.errorMsg"
              },
              {
                "$if": {
                  "condition": {
                    "$and": [
                      {
                        "$eq": [
                          {
                            "$lower": {
                              "$trim": {
                                "$ref": "response.result.status"
                              }
                            }
                          },
                          "success"
                        ]
                      },
                      {
                        "$eq": [
                          {
                            "$len": {
                              "$trim": {
                                "$coalesce": [
                                  {
                                    "$ref": "response.result.voice.demoAudioUrl"
                                  },
                                  {
                                    "$ref": "response.result.voice.audioUrl"
                                  },
                                  {
                                    "$ref": "response.result.audioUrl"
                                  },
                                  {
                                    "$ref": "response.result.filePath"
                                  }
                                ]
                              }
                            }
                          },
                          0
                        ]
                      },
                      {
                        "$ne": [
                          {
                            "$trim": {
                              "$ref": "taskId"
                            }
                          },
                          ""
                        ]
                      }
                    ]
                  },
                  "then": "TopView 任务已结束，但没有返回可用的音频文件",
                  "else": null
                }
              }
            ]
          },
          "audios": {
            "$coalesce": [
              {
                "$ref": "response.result.voice.demoAudioUrl"
              },
              {
                "$ref": "response.result.voice.audioUrl"
              },
              {
                "$ref": "response.result.audioUrl"
              },
              {
                "$ref": "response.result.filePath"
              }
            ]
          },
          "resultEphemeral": true
        }
      }
    ]
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
