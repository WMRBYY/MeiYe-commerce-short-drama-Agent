# APIMart Seedance 2.0 接口字段

| 统一字段 | 上游字段 |
| --- | --- |
| `model` | `model`，仅 `seedance-2.0`、`seedance-2.0-fast`、`seedance-2.0-mini` |
| `prompt` | `prompt` |
| `duration` | `duration`，4–15 秒 |
| `aspectRatio` | `size` |
| `resolution` | `resolution`；Fast 和 Mini 只支持 `480p`、`720p` |
| `generateAudio` | `generate_audio` |
| `images` | `image_urls` 或 `image_with_roles`，最多 9 张 |
| `videos` | `video_urls`，最多 3 个 |
| `audios` | `audio_urls`，最多 3 个 |

`providerOptions.apimart-seedance-2` 支持原名 `seed`、`nsfw_check`、`return_last_frame`、`tools`。创建响应读取 `data[0].task_id`，查询读取 `data.status`、`data.result.videos[]`，可选尾帧在 `data.result.images[]`。媒体 URL 由宿主下载保存。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "apimart-seedance-2",
  "name": "APIMart Seedance 2.0",
  "version": "1.0.0",
  "author": "APIMart / MeiyeAI",
  "description": "APIMart Seedance 2.0、Fast、Mini 视频生成协议。",
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
        "id": "apimart-seedance-2",
        "label": "APIMart Seedance 2.0",
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
        "baseUrl": "https://service-3347642c.example.invalid/v1",
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
              "seedance-2.0",
              "seedance-2.0-fast",
              "seedance-2.0-mini"
            ],
            "mapping": "model",
            "description": "APIMart Seedance 2.0 模型 ID。"
          },
          {
            "name": "prompt",
            "type": "string",
            "mapping": "prompt",
            "description": "文生视频必填，参考生成可省略。"
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image_urls / image_with_roles",
            "description": "普通图片进 image_urls；首帧、尾帧、参考人像角色进 image_with_roles。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "mapping": "video_urls",
            "description": "最多 3 个参考视频。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "mapping": "audio_urls",
            "description": "最多 3 个参考音频。"
          },
          {
            "name": "duration",
            "type": "integer",
            "mapping": "duration",
            "description": "4–15 秒，默认 5 秒。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "mapping": "size",
            "description": "16:9、9:16、1:1、4:3、3:4、21:9 或 adaptive。"
          },
          {
            "name": "resolution",
            "type": "string",
            "mapping": "resolution",
            "description": "480p、720p；标准版另支持 1080p 和 4k。"
          },
          {
            "name": "generateAudio",
            "type": "boolean",
            "mapping": "generate_audio",
            "description": "默认开启生成音频。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "apimart-seedance-2.*",
            "description": "seed、nsfw_check、return_last_frame、tools。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$in": [
                {
                  "$ref": "request.model"
                },
                [
                  "seedance-2.0",
                  "seedance-2.0-fast",
                  "seedance-2.0-mini"
                ]
              ]
            },
            "message": "Seedance 2.0 模型 ID 无效。"
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
            "message": "文生视频必须提供 prompt；参考生成必须提供图片或视频。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "request.model"
                    },
                    "seedance-2.0-mini"
                  ]
                },
                {
                  "$lte": [
                    {
                      "$len": {
                        "$ref": "request.prompt"
                      }
                    },
                    4000
                  ]
                }
              ]
            },
            "message": "Seedance 2.0 提示词不能超过 4000 字符。"
          },
          {
            "assert": {
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
                  "$and": [
                    {
                      "$gte": [
                        {
                          "$ref": "request.duration"
                        },
                        4
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
                }
              ]
            },
            "message": "Seedance 2.0 时长必须在 4–15 秒之间。"
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
                  "3:4",
                  "21:9",
                  "adaptive"
                ]
              ]
            },
            "message": "Seedance 2.0 size 不受支持。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$in": [
                    {
                      "$ref": "request.resolution"
                    },
                    [
                      "",
                      "480p",
                      "720p"
                    ]
                  ]
                },
                {
                  "$and": [
                    {
                      "$eq": [
                        {
                          "$ref": "request.model"
                        },
                        "seedance-2.0"
                      ]
                    },
                    {
                      "$in": [
                        {
                          "$ref": "request.resolution"
                        },
                        [
                          "1080p",
                          "4k"
                        ]
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "所选 Seedance 2.0 模型不支持该分辨率。"
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
            "message": "Seedance 2.0 最多接收 9 张参考图片。"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.videos"
                  }
                },
                3
              ]
            },
            "message": "Seedance 2.0 最多接收 3 个参考视频。"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.audios"
                  }
                },
                3
              ]
            },
            "message": "Seedance 2.0 最多接收 3 个参考音频。"
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
                        "$eq": [
                          {
                            "$ref": "media.role"
                          },
                          "mask"
                        ]
                      }
                    }
                  }
                },
                0
              ]
            },
            "message": "Seedance 2.0 不接收蒙版图片。"
          },
          {
            "assert": {
              "$or": [
                {
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
                                "reference_image"
                              ]
                            ]
                          }
                        }
                      }
                    },
                    0
                  ]
                },
                {
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
                                "reference_image"
                              ]
                            ]
                          }
                        }
                      }
                    },
                    {
                      "$len": {
                        "$ref": "request.images"
                      }
                    }
                  ]
                }
              ]
            },
            "message": "image_urls 和 image_with_roles 不能混用。"
          },
          {
            "assert": {
              "$or": [
                {
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
                                "last_frame"
                              ]
                            ]
                          }
                        }
                      }
                    },
                    0
                  ]
                },
                {
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
                }
              ]
            },
            "message": "使用首帧或尾帧图片时不能同时提供参考视频或音频。"
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
            "message": "参考音频需要同时提供参考图片或视频。"
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
              "$omitEmpty": {
                "$ref": "request.prompt"
              }
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
                "then": 5,
                "else": {
                  "$ref": "request.duration"
                }
              }
            },
            "size": {
              "$coalesce": [
                {
                  "$ref": "request.aspectRatio"
                },
                "16:9"
              ]
            },
            "resolution": {
              "$coalesce": [
                {
                  "$ref": "request.resolution"
                },
                "720p"
              ]
            },
            "generate_audio": {
              "$ref": "request.generateAudio"
            },
            "seed": {
              "$ref": "request.providerOptions.apimart-seedance-2.seed"
            },
            "nsfw_check": {
              "$ref": "request.providerOptions.apimart-seedance-2.nsfw_check"
            },
            "return_last_frame": {
              "$ref": "request.providerOptions.apimart-seedance-2.return_last_frame"
            },
            "tools": {
              "$ref": "request.providerOptions.apimart-seedance-2.tools"
            },
            "image_urls": {
              "$if": {
                "condition": {
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
                                "reference_image"
                              ]
                            ]
                          }
                        }
                      }
                    },
                    0
                  ]
                },
                "then": {
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
                "else": null
              }
            },
            "image_with_roles": {
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
                        "$in": [
                          {
                            "$ref": "media.role"
                          },
                          [
                            "first_frame",
                            "last_frame",
                            "reference_image"
                          ]
                        ]
                      }
                    }
                  },
                  "as": "media",
                  "in": {
                    "url": {
                      "$ref": "media.value"
                    },
                    "role": {
                      "$ref": "media.role"
                    }
                  }
                }
              }
            },
            "video_urls": {
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
            "audio_urls": {
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
          "path": "/v1/tasks/{{taskId}}"
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
          "videos": {
            "$coalesce": [
              {
                "$ref": "response.data.result.videos"
              },
              {
                "$ref": "response.result.videos"
              }
            ]
          },
          "images": {
            "$coalesce": [
              {
                "$ref": "response.data.result.images"
              },
              {
                "$ref": "response.result.images"
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
