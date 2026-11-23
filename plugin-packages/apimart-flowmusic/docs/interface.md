# APIMart Flow Music 接口字段

| 统一输入 | 上游字段 | 说明 |
| --- | --- | --- |
| `model` | `model` | 必须为 `flowmusic`。 |
| `prompt` | `sound_prompt` | 与 `lyrics` 至少提供一个。 |
| `providerOptions.apimart-flowmusic.version` | `version` | 可选 `lyria-3.5`。 |
| `providerOptions.apimart-flowmusic.lyrics` | `lyrics` | 歌词。 |
| `providerOptions.apimart-flowmusic.title` | `title` | 标题。 |
| `providerOptions.apimart-flowmusic.bpm` | `bpm` | 字符串，至少 1。 |
| `providerOptions.apimart-flowmusic.length` | `length` | 整数，1–240 秒。 |
| `providerOptions.apimart-flowmusic.seed` | `seed` | 字符串随机种子。 |

创建响应读取 `data[0].task_id`；轮询读取 `data.status` 与 `data.result.music[].audio_url`。错误保留失败状态；返回的音频 URL 由宿主下载保存。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "apimart-flowmusic",
  "name": "APIMart Flow Music",
  "version": "1.0.0",
  "author": "APIMart / MeiyeAI",
  "description": "APIMart Flow Music 与 Lyria 3.5 音乐生成协议。",
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
        "id": "apimart-flowmusic",
        "label": "APIMart Flow Music",
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
        "baseUrl": "https://service-3347642c.example.invalid/v1",
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
            "values": [
              "flowmusic"
            ],
            "mapping": "model",
            "description": "固定为 flowmusic；Lyria 3.5 通过 version 选择。"
          },
          {
            "name": "prompt",
            "type": "string",
            "mapping": "sound_prompt",
            "description": "音乐风格或声音描述；与 lyrics 至少提供一个。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "apimart-flowmusic.*",
            "description": "version、lyrics、title、bpm、length、seed；字段名与上游一致。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.model"
                },
                "flowmusic"
              ]
            },
            "message": "Flow Music 模型 ID 必须为 flowmusic。"
          },
          {
            "assert": {
              "$or": [
                {
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
                {
                  "$gt": [
                    {
                      "$len": {
                        "$trim": {
                          "$ref": "request.providerOptions.apimart-flowmusic.lyrics"
                        }
                      }
                    },
                    0
                  ]
                }
              ]
            },
            "message": "sound_prompt 与 lyrics 至少提供一个。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "request.providerOptions.apimart-flowmusic.version"
                    },
                    null
                  ]
                },
                {
                  "$eq": [
                    {
                      "$ref": "request.providerOptions.apimart-flowmusic.version"
                    },
                    "lyria-3.5"
                  ]
                }
              ]
            },
            "message": "Flow Music version 仅支持 lyria-3.5；普通版本请留空。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "request.providerOptions.apimart-flowmusic.length"
                    },
                    null
                  ]
                },
                {
                  "$and": [
                    {
                      "$gte": [
                        {
                          "$ref": "request.providerOptions.apimart-flowmusic.length"
                        },
                        1
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$ref": "request.providerOptions.apimart-flowmusic.length"
                        },
                        240
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "Flow Music length 必须在 1–240 秒之间。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "request.providerOptions.apimart-flowmusic.bpm"
                    },
                    null
                  ]
                },
                {
                  "$gte": [
                    {
                      "$toFloat": {
                        "$ref": "request.providerOptions.apimart-flowmusic.bpm"
                      }
                    },
                    1
                  ]
                }
              ]
            },
            "message": "Flow Music bpm 必须为不小于 1 的数字字符串。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/music/generations",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "sound_prompt": {
              "$omitEmpty": {
                "$ref": "request.prompt"
              }
            },
            "version": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.apimart-flowmusic.version"
              }
            },
            "lyrics": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.apimart-flowmusic.lyrics"
              }
            },
            "title": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.apimart-flowmusic.title"
              }
            },
            "bpm": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.apimart-flowmusic.bpm"
              }
            },
            "length": {
              "$ref": "request.providerOptions.apimart-flowmusic.length"
            },
            "seed": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.apimart-flowmusic.seed"
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/music/tasks/{{taskId}}"
        },
        "response": {
          "taskIdPaths": [
            "data.0.task_id",
            "data.task_id",
            "data.id",
            "task_id"
          ],
          "statusPaths": [
            "data.0.status",
            "data.status",
            "status"
          ],
          "messagePaths": [
            "data.error.message",
            "error.message",
            "message"
          ],
          "errorPaths": [
            "data.error.code",
            "error.code",
            "error.type"
          ],
          "audios": {
            "$coalesce": [
              {
                "$ref": "response.data.result.music"
              },
              {
                "$ref": "response.result.music"
              }
            ]
          },
          "resultEphemeral": true
        }
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
