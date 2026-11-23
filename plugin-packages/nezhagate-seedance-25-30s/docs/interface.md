# NezhaGate Seedance 2.5 · 30s 接口

## 创建与查询

- `POST /v1/videos/generations`，JSON 请求，Bearer `apiKey`。HTTP 202 返回 `id`、`status: queued`。
- `GET /v1/videos/jobs/{id}`，状态为 `queued`、`processing`、`succeeded` 或 `failed`。
- 成功时读取 `data[0].url`；失败时读取 `error.code`、`error.message`。结果 URL 有时效，由宿主保存媒体。

## 参数映射

| 统一参数 | NezhaGate 参数 | 限制 |
| --- | --- | --- |
| `model` | `model` | 仅 `seedance-2.5-30s` |
| `prompt` | `prompt` | 必填，最多 5000 UTF-8 字节 |
| `images` | `images` | 最多 9 张，作为有序参考图；不支持首帧、尾帧或蒙版 |
| `duration` | `duration` | 仅 30 秒 |
| `resolution` | `resolution` | 仅 `720P` |
| `aspectRatio` | `size` | `16:9`、`9:16`、`1:1`、`4:3`、`3:4` |

成片始终带声音，协议不发送 `audio`。不接收参考视频和参考音频，也不转发 `seed`、`negative_prompt`、`fps`、`watermark` 或 `n`，避免无效字段和额外预扣。`images` 的顺序对应提示词里的 `@Image1`、`@Image2` 等。单张图片上游限制为 16 MB。`callback_url` 为可选 Webhook；当前插件使用轮询，不提交回调地址。

## 响应映射

创建响应中的 `id` 用于查询；`queued`、`processing` 映射为未完成，`succeeded` 映射成功，`failed` 映射失败。成功时将 `data` 数组中的 URL 作为视频结果，由宿主下载保存，避免依赖上游临时链接。

上游规范：[Seedance 2.5 · 30s](https://service-01b31036.example.invalid/docs/seedance-2.5-30s)。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "nezhagate-seedance-25-30s",
  "name": "NezhaGate Seedance 2.5 30s",
  "version": "1.0.0",
  "author": "NezhaGate / MeiyeAI",
  "description": "NezhaGate Seedance 2.5 固定 30 秒视频生成协议。",
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
        "id": "nezhagate-seedance-25-30s",
        "label": "NezhaGate Seedance 2.5 · 30s",
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
        "baseUrl": "https://service-01b31036.example.invalid/v1",
        "requiresPublicMediaUrls": true,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "parameters": [
          {
            "name": "model",
            "type": "string",
            "required": true,
            "values": [
              "seedance-2.5-30s"
            ],
            "mapping": "model",
            "description": "固定为 seedance-2.5-30s。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "必填；UTF-8 编码最多 5000 字节。"
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "images",
            "description": "最多 9 张参考图，按顺序对应 @Image1 等标记；不作为首帧。"
          },
          {
            "name": "duration",
            "type": "integer",
            "mapping": "duration",
            "description": "固定 30 秒。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "mapping": "size",
            "description": "16:9、9:16、1:1、4:3、3:4。"
          },
          {
            "name": "resolution",
            "type": "string",
            "mapping": "resolution",
            "description": "固定 720P。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.model"
                },
                "seedance-2.5-30s"
              ]
            },
            "message": "模型 ID 必须为 seedance-2.5-30s。"
          },
          {
            "assert": {
              "$gt": [
                {
                  "$len": {
                    "$trim": {
                      "$ref": "request.prompt"
                    }
                  }
                },
                0
              ]
            },
            "message": "Seedance 2.5 30s 必须提供提示词。"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$utf8Bytes": {
                    "$ref": "request.prompt"
                  }
                },
                5000
              ]
            },
            "message": "提示词超过 5000 UTF-8 字节。"
          },
          {
            "assert": {
              "$in": [
                {
                  "$ref": "request.duration"
                },
                [
                  0,
                  30
                ]
              ]
            },
            "message": "该型号仅支持固定 30 秒。"
          },
          {
            "assert": {
              "$in": [
                {
                  "$ref": "request.resolution"
                },
                [
                  "",
                  "720P",
                  "720p"
                ]
              ]
            },
            "message": "该型号仅支持 720P。"
          },
          {
            "assert": {
              "$in": [
                {
                  "$ref": "request.aspectRatio"
                },
                [
                  "",
                  "16:9",
                  "9:16",
                  "1:1",
                  "4:3",
                  "3:4"
                ]
              ]
            },
            "message": "该型号不支持所选画面比例。"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.images"
                  }
                },
                9
              ]
            },
            "message": "最多支持 9 张参考图。"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$ref": "request.videos"
                  }
                },
                0
              ]
            },
            "message": "该型号不支持参考视频。"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$ref": "request.audios"
                  }
                },
                0
              ]
            },
            "message": "该型号不支持参考音频。"
          },
          {
            "assert": {
              "$eq": [
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
                            "mask"
                          ]
                        ]
                      }
                    }
                  }
                },
                0
              ]
            },
            "message": "参考图不能指定首帧、尾帧或蒙版角色。"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$ref": "request.output.count"
                },
                1
              ]
            },
            "message": "每次任务只生成一条视频。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/videos/generations",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "duration": 30,
            "resolution": "720P",
            "size": {
              "$coalesce": [
                {
                  "$ref": "request.aspectRatio"
                },
                "16:9"
              ]
            },
            "images": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$sortByOrder": {
                      "$ref": "request.images"
                    }
                  },
                  "as": "media",
                  "in": {
                    "$ref": "media.value"
                  }
                }
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/videos/jobs/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.id"
              },
              {
                "$ref": "taskId"
              }
            ]
          },
          "status": {
            "$coalesce": [
              {
                "$ref": "response.status"
              },
              "pending"
            ]
          },
          "message": {
            "$coalesce": [
              {
                "$ref": "response.error.message"
              },
              {
                "$ref": "response.message"
              }
            ]
          },
          "videos": {
            "$ref": "response.data"
          },
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true
        }
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
