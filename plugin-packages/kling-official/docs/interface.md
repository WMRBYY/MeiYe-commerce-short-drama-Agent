# 可灵官方 接口字段

## 协议身份

- 插件 ID：`kling-official`。
- Provider ID：`kling-official`。
- 能力：`video`。
- 默认 Base URL：`https://api-beijing.klingai.com`。
- 鉴权驱动：`bearer`。
- 创建：`POST /text-to-video/kling-3.0`。
- 查询：`GET /tasks`。

## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | API Key |

## 统一字段映射

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `endpoint` | 当前支持 kling-3.0。 |
| `prompt` | string | 是 | `prompt/contents` | 视频提示词，最多 3072 字符。 |
| `images` | media[] | 否 | `contents` | 首帧与可选尾帧；不支持角色参考图片。 |
| `duration` | integer | 是 | `settings.duration` | 3–15 秒整数。 |
| `aspectRatio` | string | 否 | `settings.aspect_ratio` | 16:9、9:16、1:1。图生视频由图片决定。 |
| `resolution` | string | 否 | `settings.resolution` | 720p、1080p、4k。 |
| `generateAudio` | boolean | 否 | `settings.audio` | 原生音频开关。 |

## 上游请求模板逐字段清单

下表由插件请求模板生成，覆盖 body、query、headers 和 multipart 文件声明中的每个字段。

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/text-to-video/kling-3.0"` |
| `create.contentType` | `"application/json"` |
| `create.body` | `{"$merge":[{"$if":{"condition":{"$gt":[{"$len":{"$sortByOrder":{"$ref":"request.images"}}},0]},"then":{"contents":{"$concatArrays":[[{"type":"prompt","text":{"$ref":"request.prompt"}}],{"$map":{"from":{"$sortByOrder":{"$ref":"request.images"}},"as":"image","in":{"type":{"$ref":"image.role"},"url":{"$ref":"image.value"}}}}]}},"else":{"prompt":{"$ref":"request.prompt"}}}},{"settings":{"duration":{"$ref":"request.duration"},"resolution":{"$lower":{"$ref":"request.resolution"}},"aspect_ratio":{"$omitEmpty":{"$if":{"condition":{"$gt":[{"$len":{"$sortByOrder":{"$ref":"request.images"}}},0]},"then":null,"else":{"$coalesce":[{"$ref":"request.aspectRatio"},"16:9"]}}}},"audio":{"$if":{"condition":{"$ref":"request.generateAudio"},"then":"native","else":"off"}},"multi_shot":false}}]}` |
| `poll.method` | `"GET"` |
| `poll.path` | `"/tasks"` |
| `poll.contentType` | `"application/json"` |
| `poll.query.task_ids` | `{"$ref":"taskId"}` |

## Provider 扩展键

- 无额外扩展键。

动态模型或工作流允许使用文档声明的完整 `parameters/input/extra_body` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.taskId` | `{"$coalesce":[{"$ref":"response.data.id"},{"$ref":"taskId"}]}` |
| `response.status` | `{"$if":{"condition":{"$ne":[{"$ref":"response.code"},0]},"then":"failed","else":{"$if":{"condition":{"$and":[{"$eq":[{"$coalesce":[{"$ref":"response.data.status"},{"$first":{"$map":{"from":{"$filter":{"from":{"$ref":"response.data"},"as":"task","where":{"$eq":[{"$ref":"task.id"},{"$ref":"taskId"}]}}},"as":"task","in":{"$ref":"task.status"}}}}]},"succeeded"]},{"$eq":[{"$len":{"$map":{"from":{"$filter":{"from":{"$first":{"$map":{"from":{"$filter":{"from":{"$ref":"response.data"},"as":"task","where":{"$eq":[{"$ref":"task.id"},{"$ref":"taskId"}]}}},"as":"task","in":{"$ref":"task.outputs"}}}},"as":"output","where":{"$eq":[{"$ref":"output.type"},"video"]}}},"as":"output","in":{"$ref":"output.url"}}}},0]}]},"then":"failed","else":{"$coalesce":[{"$coalesce":[{"$ref":"response.data.status"},{"$first":{"$map":{"from":{"$filter":{"from":{"$ref":"response.data"},"as":"task","where":{"$eq":[{"$ref":"task.id"},{"$ref":"taskId"}]}}},"as":"task","in":{"$ref":"task.status"}}}}]},"pending"]}}}}}` |
| `response.message` | `{"$if":{"condition":{"$ne":[{"$ref":"response.code"},0]},"then":{"$coalesce":[{"$ref":"response.message"},"可灵请求失败"]},"else":{"$if":{"condition":{"$and":[{"$eq":[{"$coalesce":[{"$ref":"response.data.status"},{"$first":{"$map":{"from":{"$filter":{"from":{"$ref":"response.data"},"as":"task","where":{"$eq":[{"$ref":"task.id"},{"$ref":"taskId"}]}}},"as":"task","in":{"$ref":"task.status"}}}}]},"succeeded"]},{"$eq":[{"$len":{"$map":{"from":{"$filter":{"from":{"$first":{"$map":{"from":{"$filter":{"from":{"$ref":"response.data"},"as":"task","where":{"$eq":[{"$ref":"task.id"},{"$ref":"taskId"}]}}},"as":"task","in":{"$ref":"task.outputs"}}}},"as":"output","where":{"$eq":[{"$ref":"output.type"},"video"]}}},"as":"output","in":{"$ref":"output.url"}}}},0]}]},"then":"可灵任务已结束，但未返回视频文件","else":{"$first":{"$map":{"from":{"$filter":{"from":{"$ref":"response.data"},"as":"task","where":{"$eq":[{"$ref":"task.id"},{"$ref":"taskId"}]}}},"as":"task","in":{"$ref":"task.message"}}}}}}}}` |
| `response.videos` | `{"$map":{"from":{"$filter":{"from":{"$first":{"$map":{"from":{"$filter":{"from":{"$ref":"response.data"},"as":"task","where":{"$eq":[{"$ref":"task.id"},{"$ref":"taskId"}]}}},"as":"task","in":{"$ref":"task.outputs"}}}},"as":"output","where":{"$eq":[{"$ref":"output.type"},"video"]}}},"as":"output","in":{"$ref":"output.url"}}}` |
| `response.resultEphemeral` | `true` |

## 响应与错误

插件把上游 task/status/text/media/usage 映射为统一结果。临时媒体 URL 标记为 ephemeral，由宿主立即下载持久化。HTTP 错误、业务 code 和 error object 保持失败语义，不包装成成功。

## 兼容边界

对接官方新版单 API Key，旧 AK/SK 不能直接填入。创建和查询使用同一区域；GET /tasks 按原任务 ID 查询，不重新提交。响应中临时视频 URL 交由宿主下载保存。官方文档：https://kling.ai/document-api/apiReference/model/textToVideo 与 imageToVideo。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "kling-official",
  "name": "可灵官方",
  "version": "2.0.0",
  "author": "Kuaishou / MeiyeAI",
  "description": "可灵官方 独立请求协议插件。",
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
        "id": "kling-official",
        "label": "可灵官方",
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
        "baseUrl": "https://api-beijing.klingai.com",
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
            "mapping": "endpoint",
            "description": "当前支持 kling-3.0。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt/contents",
            "description": "视频提示词，最多 3072 字符。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "contents",
            "description": "首帧与可选尾帧；不支持角色参考图片。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": true,
            "mapping": "settings.duration",
            "description": "3–15 秒整数。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "settings.aspect_ratio",
            "description": "16:9、9:16、1:1。图生视频由图片决定。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "settings.resolution",
            "description": "720p、1080p、4k。"
          },
          {
            "name": "generateAudio",
            "type": "boolean",
            "required": false,
            "mapping": "settings.audio",
            "description": "原生音频开关。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.model"
                },
                "kling-3.0"
              ]
            },
            "message": "可灵官方当前支持模型 kling-3.0"
          },
          {
            "assert": {
              "$and": [
                {
                  "$gte": [
                    {
                      "$ref": "request.duration"
                    },
                    3
                  ]
                },
                {
                  "$lte": [
                    {
                      "$ref": "request.duration"
                    },
                    15
                  ]
                }
              ]
            },
            "message": "可灵视频时长须为 3–15 秒"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.prompt"
                  }
                },
                3072
              ]
            },
            "message": "可灵提示词最多 3072 字符"
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
                },
                {
                  "$lte": [
                    {
                      "$len": {
                        "$sortByOrder": {
                          "$ref": "request.images"
                        }
                      }
                    },
                    2
                  ]
                }
              ]
            },
            "message": "当前可灵协议支持文字或首尾帧图片，不支持参考视频和音频"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$sortByOrder": {
                          "$ref": "request.images"
                        }
                      },
                      "as": "image",
                      "where": {
                        "$not": {
                          "$in": [
                            {
                              "$ref": "image.role"
                            },
                            [
                              "first_frame",
                              "last_frame"
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
            "message": "可灵图片须指定首帧或尾帧"
          },
          {
            "assert": {
              "$if": {
                "condition": {
                  "$gt": [
                    {
                      "$len": {
                        "$sortByOrder": {
                          "$ref": "request.images"
                        }
                      }
                    },
                    0
                  ]
                },
                "then": {
                  "$and": [
                    {
                      "$eq": [
                        {
                          "$len": {
                            "$filter": {
                              "from": {
                                "$sortByOrder": {
                                  "$ref": "request.images"
                                }
                              },
                              "as": "image",
                              "where": {
                                "$eq": [
                                  {
                                    "$ref": "image.role"
                                  },
                                  "first_frame"
                                ]
                              }
                            }
                          }
                        },
                        1
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$len": {
                            "$filter": {
                              "from": {
                                "$sortByOrder": {
                                  "$ref": "request.images"
                                }
                              },
                              "as": "image",
                              "where": {
                                "$eq": [
                                  {
                                    "$ref": "image.role"
                                  },
                                  "last_frame"
                                ]
                              }
                            }
                          }
                        },
                        1
                      ]
                    }
                  ]
                },
                "else": true
              }
            },
            "message": "图生视频需要一张首帧，最多一张尾帧"
          },
          {
            "assert": {
              "$in": [
                {
                  "$lower": {
                    "$ref": "request.resolution"
                  }
                },
                [
                  "720p",
                  "1080p",
                  "4k"
                ]
              ]
            },
            "message": "可灵分辨率须为 720p、1080p 或 4k"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/text-to-video/kling-3.0",
          "contentType": "application/json",
          "pathTemplate": {
            "$if": {
              "condition": {
                "$gt": [
                  {
                    "$len": {
                      "$sortByOrder": {
                        "$ref": "request.images"
                      }
                    }
                  },
                  0
                ]
              },
              "then": "/image-to-video/kling-3.0",
              "else": "/text-to-video/kling-3.0"
            }
          },
          "body": {
            "$merge": [
              {
                "$if": {
                  "condition": {
                    "$gt": [
                      {
                        "$len": {
                          "$sortByOrder": {
                            "$ref": "request.images"
                          }
                        }
                      },
                      0
                    ]
                  },
                  "then": {
                    "contents": {
                      "$concatArrays": [
                        [
                          {
                            "type": "prompt",
                            "text": {
                              "$ref": "request.prompt"
                            }
                          }
                        ],
                        {
                          "$map": {
                            "from": {
                              "$sortByOrder": {
                                "$ref": "request.images"
                              }
                            },
                            "as": "image",
                            "in": {
                              "type": {
                                "$ref": "image.role"
                              },
                              "url": {
                                "$ref": "image.value"
                              }
                            }
                          }
                        }
                      ]
                    }
                  },
                  "else": {
                    "prompt": {
                      "$ref": "request.prompt"
                    }
                  }
                }
              },
              {
                "settings": {
                  "duration": {
                    "$ref": "request.duration"
                  },
                  "resolution": {
                    "$lower": {
                      "$ref": "request.resolution"
                    }
                  },
                  "aspect_ratio": {
                    "$omitEmpty": {
                      "$if": {
                        "condition": {
                          "$gt": [
                            {
                              "$len": {
                                "$sortByOrder": {
                                  "$ref": "request.images"
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
                              "$ref": "request.aspectRatio"
                            },
                            "16:9"
                          ]
                        }
                      }
                    }
                  },
                  "audio": {
                    "$if": {
                      "condition": {
                        "$ref": "request.generateAudio"
                      },
                      "then": "native",
                      "else": "off"
                    }
                  },
                  "multi_shot": false
                }
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/tasks",
          "query": {
            "task_ids": {
              "$ref": "taskId"
            }
          }
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.data.id"
              },
              {
                "$ref": "taskId"
              }
            ]
          },
          "status": {
            "$if": {
              "condition": {
                "$ne": [
                  {
                    "$ref": "response.code"
                  },
                  0
                ]
              },
              "then": "failed",
              "else": {
                "$if": {
                  "condition": {
                    "$and": [
                      {
                        "$eq": [
                          {
                            "$coalesce": [
                              {
                                "$ref": "response.data.status"
                              },
                              {
                                "$first": {
                                  "$map": {
                                    "from": {
                                      "$filter": {
                                        "from": {
                                          "$ref": "response.data"
                                        },
                                        "as": "task",
                                        "where": {
                                          "$eq": [
                                            {
                                              "$ref": "task.id"
                                            },
                                            {
                                              "$ref": "taskId"
                                            }
                                          ]
                                        }
                                      }
                                    },
                                    "as": "task",
                                    "in": {
                                      "$ref": "task.status"
                                    }
                                  }
                                }
                              }
                            ]
                          },
                          "succeeded"
                        ]
                      },
                      {
                        "$eq": [
                          {
                            "$len": {
                              "$map": {
                                "from": {
                                  "$filter": {
                                    "from": {
                                      "$first": {
                                        "$map": {
                                          "from": {
                                            "$filter": {
                                              "from": {
                                                "$ref": "response.data"
                                              },
                                              "as": "task",
                                              "where": {
                                                "$eq": [
                                                  {
                                                    "$ref": "task.id"
                                                  },
                                                  {
                                                    "$ref": "taskId"
                                                  }
                                                ]
                                              }
                                            }
                                          },
                                          "as": "task",
                                          "in": {
                                            "$ref": "task.outputs"
                                          }
                                        }
                                      }
                                    },
                                    "as": "output",
                                    "where": {
                                      "$eq": [
                                        {
                                          "$ref": "output.type"
                                        },
                                        "video"
                                      ]
                                    }
                                  }
                                },
                                "as": "output",
                                "in": {
                                  "$ref": "output.url"
                                }
                              }
                            }
                          },
                          0
                        ]
                      }
                    ]
                  },
                  "then": "failed",
                  "else": {
                    "$coalesce": [
                      {
                        "$coalesce": [
                          {
                            "$ref": "response.data.status"
                          },
                          {
                            "$first": {
                              "$map": {
                                "from": {
                                  "$filter": {
                                    "from": {
                                      "$ref": "response.data"
                                    },
                                    "as": "task",
                                    "where": {
                                      "$eq": [
                                        {
                                          "$ref": "task.id"
                                        },
                                        {
                                          "$ref": "taskId"
                                        }
                                      ]
                                    }
                                  }
                                },
                                "as": "task",
                                "in": {
                                  "$ref": "task.status"
                                }
                              }
                            }
                          }
                        ]
                      },
                      "pending"
                    ]
                  }
                }
              }
            }
          },
          "message": {
            "$if": {
              "condition": {
                "$ne": [
                  {
                    "$ref": "response.code"
                  },
                  0
                ]
              },
              "then": {
                "$coalesce": [
                  {
                    "$ref": "response.message"
                  },
                  "可灵请求失败"
                ]
              },
              "else": {
                "$if": {
                  "condition": {
                    "$and": [
                      {
                        "$eq": [
                          {
                            "$coalesce": [
                              {
                                "$ref": "response.data.status"
                              },
                              {
                                "$first": {
                                  "$map": {
                                    "from": {
                                      "$filter": {
                                        "from": {
                                          "$ref": "response.data"
                                        },
                                        "as": "task",
                                        "where": {
                                          "$eq": [
                                            {
                                              "$ref": "task.id"
                                            },
                                            {
                                              "$ref": "taskId"
                                            }
                                          ]
                                        }
                                      }
                                    },
                                    "as": "task",
                                    "in": {
                                      "$ref": "task.status"
                                    }
                                  }
                                }
                              }
                            ]
                          },
                          "succeeded"
                        ]
                      },
                      {
                        "$eq": [
                          {
                            "$len": {
                              "$map": {
                                "from": {
                                  "$filter": {
                                    "from": {
                                      "$first": {
                                        "$map": {
                                          "from": {
                                            "$filter": {
                                              "from": {
                                                "$ref": "response.data"
                                              },
                                              "as": "task",
                                              "where": {
                                                "$eq": [
                                                  {
                                                    "$ref": "task.id"
                                                  },
                                                  {
                                                    "$ref": "taskId"
                                                  }
                                                ]
                                              }
                                            }
                                          },
                                          "as": "task",
                                          "in": {
                                            "$ref": "task.outputs"
                                          }
                                        }
                                      }
                                    },
                                    "as": "output",
                                    "where": {
                                      "$eq": [
                                        {
                                          "$ref": "output.type"
                                        },
                                        "video"
                                      ]
                                    }
                                  }
                                },
                                "as": "output",
                                "in": {
                                  "$ref": "output.url"
                                }
                              }
                            }
                          },
                          0
                        ]
                      }
                    ]
                  },
                  "then": "可灵任务已结束，但未返回视频文件",
                  "else": {
                    "$first": {
                      "$map": {
                        "from": {
                          "$filter": {
                            "from": {
                              "$ref": "response.data"
                            },
                            "as": "task",
                            "where": {
                              "$eq": [
                                {
                                  "$ref": "task.id"
                                },
                                {
                                  "$ref": "taskId"
                                }
                              ]
                            }
                          }
                        },
                        "as": "task",
                        "in": {
                          "$ref": "task.message"
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          "videos": {
            "$map": {
              "from": {
                "$filter": {
                  "from": {
                    "$first": {
                      "$map": {
                        "from": {
                          "$filter": {
                            "from": {
                              "$ref": "response.data"
                            },
                            "as": "task",
                            "where": {
                              "$eq": [
                                {
                                  "$ref": "task.id"
                                },
                                {
                                  "$ref": "taskId"
                                }
                              ]
                            }
                          }
                        },
                        "as": "task",
                        "in": {
                          "$ref": "task.outputs"
                        }
                      }
                    }
                  },
                  "as": "output",
                  "where": {
                    "$eq": [
                      {
                        "$ref": "output.type"
                      },
                      "video"
                    ]
                  }
                }
              },
              "as": "output",
              "in": {
                "$ref": "output.url"
              }
            }
          },
          "resultEphemeral": true
        }
      }
    ]
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
