# NezhaGate Seedance 2.5 接口

## 创建、查询与响应

- `POST /v1/videos/generations`，JSON 请求，`Authorization: Bearer apiKey`。HTTP 202 返回 `id` 和 `queued` 状态。
- `GET /v1/videos/jobs/{id}`，任务状态为 `queued`、`processing`、`succeeded` 或 `failed`。
- 成功时读取 `data[0].url`；失败时读取 `error.code` 和 `error.message`。成片 URL 保留 15 天，由宿主保存媒体。

## 参数映射

| 统一参数 | NezhaGate 参数 | 限制 |
| --- | --- | --- |
| `model` | `model` | 仅 `seedance-2.5` |
| `prompt` | `prompt` | 必填，最多 11000 个 Unicode 字符 |
| `duration` | `duration` | 4–30 秒整数，默认 4 秒 |
| `resolution` | `resolution` | `480P`、`720P`、`1080P`，默认 `720P` |
| `aspectRatio` | `size` | `16:9`、`9:16`、`1:1`、`4:3`、`3:4` |
| `images` | `images` | 最多 30 张，每张最多 16 MB，按顺序对应 `@Image1`；不是首帧 |
| `videos` | `video_references` | 最多 10 段，单段最多 50 MB，合计最长 30 秒，对应 `@Video1` |
| `audios` | `audio_reference` | 最多 10 段，每段最多 15 MB / 30 秒，公网 HTTP(S) 直链；需同时提供参考图或视频，对应 `@Audio1` |

参考视频支持公网直链或视频 `data:` URI。上传媒体需要由宿主提供上游可访问的 URL；无法确认媒体时长时，以供应商最终验证为准。成片始终带声音，协议不发送 `audio: false`。单个任务只生成一条成片，协议不发送 `n`，避免额外预扣。`callback_url` 为可选 Webhook；当前插件使用轮询，不提交回调地址。`seed`、`negative_prompt`、`fps`、`watermark` 不会转发。

上游规范：[NezhaGate Seedance 2.5](https://service-01b31036.example.invalid/docs/seedance-2.5)。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "nezhagate-seedance-25",
  "name": "NezhaGate Seedance 2.5",
  "version": "1.0.0",
  "author": "NezhaGate / MeiyeAI",
  "description": "NezhaGate Seedance 2.5 多模态参考视频生成协议。",
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
        "id": "nezhagate-seedance-25",
        "label": "NezhaGate Seedance 2.5",
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
              "seedance-2.5"
            ],
            "mapping": "model",
            "description": "固定为 seedance-2.5。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "必填，最多 11000 个 Unicode 字符。"
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "images",
            "description": "最多 30 张参考图，按顺序对应 @Image1 等标记；不作为首帧。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "mapping": "video_references",
            "description": "最多 10 段参考视频，单段不超过 50 MB，合计不超过 30 秒。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "mapping": "audio_reference",
            "description": "最多 10 段公网 URL 参考音频，每段不超过 30 秒；须同时有图或视频。"
          },
          {
            "name": "duration",
            "type": "integer",
            "mapping": "duration",
            "description": "4–30 秒，逐秒可选，默认 4 秒。"
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
            "description": "480P、720P、1080P，默认 720P。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.model"
                },
                "seedance-2.5"
              ]
            },
            "message": "模型 ID 必须为 seedance-2.5。"
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
            "message": "Seedance 2.5 必须提供提示词。"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.prompt"
                  }
                },
                11000
              ]
            },
            "message": "提示词超过 11000 个字符。"
          },
          {
            "assert": {
              "$and": [
                {
                  "$gte": [
                    {
                      "$ref": "request.duration"
                    },
                    0
                  ]
                },
                {
                  "$lte": [
                    {
                      "$ref": "request.duration"
                    },
                    30
                  ]
                },
                {
                  "$or": [
                    {
                      "$eq": [
                        {
                          "$ref": "request.duration"
                        },
                        0
                      ]
                    },
                    {
                      "$gte": [
                        {
                          "$ref": "request.duration"
                        },
                        4
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "该型号仅支持 4–30 秒整数时长。"
          },
          {
            "assert": {
              "$in": [
                {
                  "$ref": "request.resolution"
                },
                [
                  "",
                  "480P",
                  "720P",
                  "1080P"
                ]
              ]
            },
            "message": "该型号仅支持 480P、720P 或 1080P。"
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
                30
              ]
            },
            "message": "最多支持 30 张参考图。"
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
                        "$gt": [
                          {
                            "$ref": "media.metadata.bytes"
                          },
                          16777216
                        ]
                      }
                    }
                  }
                },
                0
              ]
            },
            "message": "单张参考图不能超过 16 MB。"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.videos"
                  }
                },
                10
              ]
            },
            "message": "最多支持 10 段参考视频。"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$ref": "request.videos"
                      },
                      "as": "media",
                      "where": {
                        "$or": [
                          {
                            "$gt": [
                              {
                                "$ref": "media.metadata.bytes"
                              },
                              52428800
                            ]
                          },
                          {
                            "$gt": [
                              {
                                "$ref": "media.metadata.durationMs"
                              },
                              30000
                            ]
                          }
                        ]
                      }
                    }
                  }
                },
                0
              ]
            },
            "message": "单段参考视频不能超过 50 MB 或 30 秒。"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$sum": {
                    "$map": {
                      "from": {
                        "$ref": "request.videos"
                      },
                      "as": "media",
                      "in": {
                        "$ref": "media.metadata.bytes"
                      }
                    }
                  }
                },
                104857600
              ]
            },
            "message": "参考视频合计不能超过 100 MB。"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$sum": {
                    "$map": {
                      "from": {
                        "$ref": "request.videos"
                      },
                      "as": "media",
                      "in": {
                        "$ref": "media.metadata.durationMs"
                      }
                    }
                  }
                },
                30000
              ]
            },
            "message": "参考视频合计不能超过 30 秒。"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.audios"
                  }
                },
                10
              ]
            },
            "message": "最多支持 10 段参考音频。"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$ref": "request.audios"
                      },
                      "as": "media",
                      "where": {
                        "$or": [
                          {
                            "$gt": [
                              {
                                "$ref": "media.metadata.bytes"
                              },
                              15728640
                            ]
                          },
                          {
                            "$gt": [
                              {
                                "$ref": "media.metadata.durationMs"
                              },
                              30000
                            ]
                          }
                        ]
                      }
                    }
                  }
                },
                0
              ]
            },
            "message": "单段参考音频不能超过 15 MB 或 30 秒。"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$ref": "request.audios"
                      },
                      "as": "media",
                      "where": {
                        "$not": {
                          "$in": [
                            {
                              "$at": [
                                {
                                  "$split": [
                                    {
                                      "$ref": "media.value"
                                    },
                                    ":"
                                  ]
                                },
                                0
                              ]
                            },
                            [
                              "http",
                              "https"
                            ]
                          ]
                        }
                      }
                    }
                  }
                },
                0
              ]
            },
            "message": "参考音频必须使用可直连的公网 HTTP(S) URL。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$len": {
                        "$ref": "request.audios"
                      }
                    },
                    0
                  ]
                },
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
                  "$gt": [
                    {
                      "$len": {
                        "$ref": "request.videos"
                      }
                    },
                    0
                  ]
                }
              ]
            },
            "message": "参考音频必须同时提供参考图或参考视频。"
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
            "duration": {
              "$if": {
                "condition": {
                  "$eq": [
                    {
                      "$ref": "request.duration"
                    },
                    0
                  ]
                },
                "then": 4,
                "else": {
                  "$ref": "request.duration"
                }
              }
            },
            "resolution": {
              "$coalesce": [
                {
                  "$ref": "request.resolution"
                },
                "720P"
              ]
            },
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
            },
            "video_references": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$sortByOrder": {
                      "$ref": "request.videos"
                    }
                  },
                  "as": "media",
                  "in": {
                    "$ref": "media.value"
                  }
                }
              }
            },
            "audio_reference": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$sortByOrder": {
                      "$ref": "request.audios"
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
