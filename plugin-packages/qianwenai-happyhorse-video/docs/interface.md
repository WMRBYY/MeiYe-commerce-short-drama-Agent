# 任务协议

在千问官方域名下发送 `POST /api/v1/services/aigc/video-generation/video-synthesis`。使用 `apiKey` 进行 Bearer 鉴权并设置 `X-DashScope-Async: enable`。请求传入模型、`input.prompt` 和输出规格。

| 模型 | 素材 |
| --- | --- |
| `happyhorse-1.1-t2v` | 文本 |
| `happyhorse-1.1-i2v` | 文本和 1 张首帧图片，`input.media` 中标记为 `first_frame` |
| `happyhorse-1.1-r2v` | 文本和 1–9 张参考图片，标记为 `reference_image` |

输出 3–15 秒，分辨率为 480P、720P 或 1080P。首帧生视频随首帧宽高比输出。

## 响应

保存 `output.task_id` 并使用 `GET /api/v1/tasks/{task_id}` 查询原任务。成功后读取并保存 `output.video_url`。上游任务过期或状态为 `UNKNOWN` 时结束查询。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "qianwenai-happyhorse-video",
  "name": "千问 AI 平台 HappyHorse 视频",
  "version": "1.0.0",
  "author": "MeiyeAI",
  "description": "HappyHorse 1.1 文生视频、首帧生视频和参考生视频。",
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
        "id": "qianwenai-happyhorse-video",
        "label": "千问 HappyHorse 视频",
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
        "baseUrl": "https://service-61a5b3b3.example.invalid",
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "validations": [
          {
            "assert": {
              "$in": [
                {
                  "$ref": "request.model"
                },
                [
                  "happyhorse-1.1-t2v",
                  "happyhorse-1.1-i2v",
                  "happyhorse-1.1-r2v"
                ]
              ]
            },
            "message": "请选择 HappyHorse 1.1 文生、首帧或参考生视频模型"
          },
          {
            "assert": {
              "$and": [
                {
                  "$eq": [
                    {
                      "$len": {
                        "$ref": "request.videos"
                      }
                    },
                    0
                  ]
                },
                {
                  "$eq": [
                    {
                      "$len": {
                        "$ref": "request.audios"
                      }
                    },
                    0
                  ]
                }
              ]
            },
            "message": "HappyHorse 1.1 支持图片参考，参考视频和参考音频不可用"
          },
          {
            "assert": {
              "$switch": {
                "cases": [
                  {
                    "when": {
                      "$eq": [
                        {
                          "$ref": "request.model"
                        },
                        "happyhorse-1.1-t2v"
                      ]
                    },
                    "then": {
                      "$eq": [
                        {
                          "$len": {
                            "$ref": "request.images"
                          }
                        },
                        0
                      ]
                    }
                  },
                  {
                    "when": {
                      "$eq": [
                        {
                          "$ref": "request.model"
                        },
                        "happyhorse-1.1-i2v"
                      ]
                    },
                    "then": {
                      "$eq": [
                        {
                          "$len": {
                            "$ref": "request.images"
                          }
                        },
                        1
                      ]
                    }
                  }
                ],
                "default": {
                  "$and": [
                    {
                      "$gte": [
                        {
                          "$len": {
                            "$ref": "request.images"
                          }
                        },
                        1
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$len": {
                            "$ref": "request.images"
                          }
                        },
                        9
                      ]
                    }
                  ]
                }
              }
            },
            "message": "文生视频使用 0 张图，首帧生视频使用 1 张图，参考生视频使用 1–9 张图"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/api/v1/services/aigc/video-generation/video-synthesis",
          "originPath": true,
          "contentType": "application/json",
          "headers": {
            "X-DashScope-Async": "enable"
          },
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "input": {
              "prompt": {
                "$ref": "request.prompt"
              },
              "media": {
                "$omitEmpty": {
                  "$map": {
                    "from": {
                      "$sortByOrder": {
                        "$ref": "request.images"
                      }
                    },
                    "as": "image",
                    "in": {
                      "type": {
                        "$if": {
                          "condition": {
                            "$eq": [
                              {
                                "$ref": "request.model"
                              },
                              "happyhorse-1.1-i2v"
                            ]
                          },
                          "then": "first_frame",
                          "else": "reference_image"
                        }
                      },
                      "url": {
                        "$ref": "image.value"
                      }
                    }
                  }
                }
              }
            },
            "parameters": {
              "duration": {
                "$omitEmpty": {
                  "$ref": "request.duration"
                }
              },
              "resolution": {
                "$omitEmpty": {
                  "$upper": {
                    "$ref": "request.resolution"
                  }
                }
              },
              "ratio": {
                "$omitEmpty": {
                  "$if": {
                    "condition": {
                      "$eq": [
                        {
                          "$ref": "request.model"
                        },
                        "happyhorse-1.1-i2v"
                      ]
                    },
                    "then": null,
                    "else": {
                      "$ref": "request.aspectRatio"
                    }
                  }
                }
              },
              "watermark": {
                "$ref": "request.watermark"
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/api/v1/tasks/{{taskId}}",
          "originPath": true
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.output.task_id"
              },
              {
                "$ref": "taskId"
              }
            ]
          },
          "status": {
            "$if": {
              "condition": {
                "$eq": [
                  {
                    "$lower": {
                      "$ref": "response.output.task_status"
                    }
                  },
                  "unknown"
                ]
              },
              "then": "failed",
              "else": {
                "$ref": "response.output.task_status"
              }
            }
          },
          "videos": {
            "$ref": "response.output.video_url"
          },
          "errorPaths": [
            "code",
            "output.code"
          ],
          "messagePaths": [
            "output.message",
            "message"
          ],
          "resultEphemeral": true,
          "usage": {
            "$ref": "response.usage"
          }
        }
      }
    ]
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
