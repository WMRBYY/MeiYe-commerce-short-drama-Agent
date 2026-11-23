# APIMart Suno V6 接口字段

统一 `model` 映射上游 `model=suno`；统一 `prompt` 直接映射 `prompt`。`providerOptions.apimart-suno` 支持上游同名字段：`custom`、`instrumental`、`version`、`custom_model_id`、`title`、`style`、`negative_tags`、`auto_lyrics`、`persona_id`、`vocal_gender`、`style_weight`、`weirdness_constraint`、`audio_weight`、`variety`、`max_mode`、`audio_format`、`duration`。

公共版本为 `v6`、`v6-wild`、`v6-mini`；未选择自定义模型时默认 `v6`。`custom_model_id` 与 `version`、`persona_id` 互斥。`duration` 仅自定义模式可用，范围 10–360 秒。`audio_format` 可为 `mp3`、`m4a`、`wav`。

提交响应读取 `data[0].task_id`；查询读取 `data.status`、`data.error.message` 和 `data.result.music[].audio_url`。`submitted` 只表示任务已受理，媒体 URL 返回后由宿主下载保存。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "apimart-suno",
  "name": "APIMart Suno V6",
  "version": "1.0.0",
  "author": "APIMart / MeiyeAI",
  "description": "APIMart Suno V6 音乐生成协议。",
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
        "id": "apimart-suno",
        "label": "APIMart Suno V6",
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
              "suno"
            ],
            "mapping": "model",
            "description": "固定为 suno。"
          },
          {
            "name": "prompt",
            "type": "string",
            "mapping": "prompt",
            "description": "灵感模式为描述，自定义模式为歌词；自定义纯音乐可省略。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "apimart-suno.*",
            "description": "custom、instrumental、version、custom_model_id、title、style、negative_tags、auto_lyrics、persona_id、vocal_gender、style_weight、weirdness_constraint、audio_weight、variety、max_mode、audio_format、duration。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.model"
                },
                "suno"
              ]
            },
            "message": "Suno 模型 ID 必须为 suno。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "request.providerOptions.apimart-suno.version"
                    },
                    null
                  ]
                },
                {
                  "$in": [
                    {
                      "$ref": "request.providerOptions.apimart-suno.version"
                    },
                    [
                      "v6",
                      "v6-wild",
                      "v6-mini"
                    ]
                  ]
                }
              ]
            },
            "message": "Suno 公共版本仅支持 v6、v6-wild 或 v6-mini。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "request.providerOptions.apimart-suno.custom_model_id"
                    },
                    null
                  ]
                },
                {
                  "$and": [
                    {
                      "$eq": [
                        {
                          "$ref": "request.providerOptions.apimart-suno.version"
                        },
                        null
                      ]
                    },
                    {
                      "$eq": [
                        {
                          "$ref": "request.providerOptions.apimart-suno.persona_id"
                        },
                        null
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "custom_model_id 与 version、persona_id 互斥。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "request.providerOptions.apimart-suno.custom"
                    },
                    true
                  ]
                },
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
                }
              ]
            },
            "message": "灵感模式必须提供 prompt。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$ne": [
                    {
                      "$ref": "request.providerOptions.apimart-suno.custom"
                    },
                    true
                  ]
                },
                {
                  "$eq": [
                    {
                      "$ref": "request.providerOptions.apimart-suno.instrumental"
                    },
                    true
                  ]
                },
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
                }
              ]
            },
            "message": "自定义演唱模式必须提供歌词 prompt。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$ne": [
                    {
                      "$ref": "request.providerOptions.apimart-suno.max_mode"
                    },
                    true
                  ]
                },
                {
                  "$eq": [
                    {
                      "$ref": "request.providerOptions.apimart-suno.custom"
                    },
                    true
                  ]
                }
              ]
            },
            "message": "Suno Max 模式要求 custom=true。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "request.providerOptions.apimart-suno.duration"
                    },
                    null
                  ]
                },
                {
                  "$and": [
                    {
                      "$eq": [
                        {
                          "$ref": "request.providerOptions.apimart-suno.custom"
                        },
                        true
                      ]
                    },
                    {
                      "$gte": [
                        {
                          "$ref": "request.providerOptions.apimart-suno.duration"
                        },
                        10
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$ref": "request.providerOptions.apimart-suno.duration"
                        },
                        360
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "Suno duration 仅在自定义模式支持 10–360 秒。"
          },
          {
            "assert": {
              "$in": [
                {
                  "$coalesce": [
                    {
                      "$ref": "request.providerOptions.apimart-suno.audio_format"
                    },
                    "mp3"
                  ]
                },
                [
                  "mp3",
                  "m4a",
                  "wav"
                ]
              ]
            },
            "message": "Suno audio_format 仅支持 mp3、m4a 或 wav。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$ne": [
                    {
                      "$ref": "request.providerOptions.apimart-suno.custom"
                    },
                    true
                  ]
                },
                {
                  "$lte": [
                    {
                      "$len": {
                        "$ref": "request.prompt"
                      }
                    },
                    5000
                  ]
                }
              ]
            },
            "message": "Suno 自定义模式歌词不能超过 5000 字符。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "request.providerOptions.apimart-suno.custom"
                    },
                    true
                  ]
                },
                {
                  "$lte": [
                    {
                      "$len": {
                        "$ref": "request.prompt"
                      }
                    },
                    3000
                  ]
                }
              ]
            },
            "message": "Suno 灵感模式提示词不能超过 3000 字符。"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.providerOptions.apimart-suno.title"
                  }
                },
                80
              ]
            },
            "message": "Suno title 不能超过 80 字符。"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.providerOptions.apimart-suno.style"
                  }
                },
                1000
              ]
            },
            "message": "Suno style 不能超过 1000 字符。"
          },
          {
            "assert": {
              "$in": [
                {
                  "$coalesce": [
                    {
                      "$ref": "request.providerOptions.apimart-suno.variety"
                    },
                    "normal"
                  ]
                },
                [
                  "off",
                  "normal",
                  "high",
                  "extra",
                  "max"
                ]
              ]
            },
            "message": "Suno variety 不受支持。"
          },
          {
            "assert": {
              "$in": [
                {
                  "$coalesce": [
                    {
                      "$ref": "request.providerOptions.apimart-suno.vocal_gender"
                    },
                    "Male"
                  ]
                },
                [
                  "Male",
                  "Female",
                  "m",
                  "f",
                  "male",
                  "female"
                ]
              ]
            },
            "message": "Suno vocal_gender 不受支持。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "request.providerOptions.apimart-suno.style_weight"
                    },
                    null
                  ]
                },
                {
                  "$and": [
                    {
                      "$gte": [
                        {
                          "$ref": "request.providerOptions.apimart-suno.style_weight"
                        },
                        0
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$ref": "request.providerOptions.apimart-suno.style_weight"
                        },
                        1
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "Suno style_weight 必须在 0–1 之间。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "request.providerOptions.apimart-suno.weirdness_constraint"
                    },
                    null
                  ]
                },
                {
                  "$and": [
                    {
                      "$gte": [
                        {
                          "$ref": "request.providerOptions.apimart-suno.weirdness_constraint"
                        },
                        0
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$ref": "request.providerOptions.apimart-suno.weirdness_constraint"
                        },
                        1
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "Suno weirdness_constraint 必须在 0–1 之间。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "request.providerOptions.apimart-suno.audio_weight"
                    },
                    null
                  ]
                },
                {
                  "$and": [
                    {
                      "$gte": [
                        {
                          "$ref": "request.providerOptions.apimart-suno.audio_weight"
                        },
                        0
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$ref": "request.providerOptions.apimart-suno.audio_weight"
                        },
                        1
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "Suno audio_weight 必须在 0–1 之间。"
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
            "prompt": {
              "$omitEmpty": {
                "$ref": "request.prompt"
              }
            },
            "custom": {
              "$coalesce": [
                {
                  "$ref": "request.providerOptions.apimart-suno.custom"
                },
                false
              ]
            },
            "instrumental": {
              "$ref": "request.providerOptions.apimart-suno.instrumental"
            },
            "version": {
              "$if": {
                "condition": {
                  "$gt": [
                    {
                      "$len": {
                        "$trim": {
                          "$ref": "request.providerOptions.apimart-suno.custom_model_id"
                        }
                      }
                    },
                    0
                  ]
                },
                "then": null,
                "else": {
                  "$coalesce": [
                    {
                      "$ref": "request.providerOptions.apimart-suno.version"
                    },
                    "v6"
                  ]
                }
              }
            },
            "custom_model_id": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.apimart-suno.custom_model_id"
              }
            },
            "title": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.apimart-suno.title"
              }
            },
            "style": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.apimart-suno.style"
              }
            },
            "negative_tags": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.apimart-suno.negative_tags"
              }
            },
            "auto_lyrics": {
              "$ref": "request.providerOptions.apimart-suno.auto_lyrics"
            },
            "persona_id": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.apimart-suno.persona_id"
              }
            },
            "vocal_gender": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.apimart-suno.vocal_gender"
              }
            },
            "style_weight": {
              "$ref": "request.providerOptions.apimart-suno.style_weight"
            },
            "weirdness_constraint": {
              "$ref": "request.providerOptions.apimart-suno.weirdness_constraint"
            },
            "audio_weight": {
              "$ref": "request.providerOptions.apimart-suno.audio_weight"
            },
            "variety": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.apimart-suno.variety"
              }
            },
            "max_mode": {
              "$ref": "request.providerOptions.apimart-suno.max_mode"
            },
            "audio_format": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.apimart-suno.audio_format"
              }
            },
            "duration": {
              "$ref": "request.providerOptions.apimart-suno.duration"
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
