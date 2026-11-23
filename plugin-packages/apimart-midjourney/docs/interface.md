# APIMart Midjourney Imagine 接口

## 上游来源

- [Midjourney API 概览](https://service-3778997d.example.invalid/cn/api-reference/images/midjourney/generation)
- [Imagine 请求与参数](https://service-3778997d.example.invalid/cn/api-reference/images/midjourney/imagine)
- [任务查询与结果](https://service-3778997d.example.invalid/cn/api-reference/images/midjourney/query)

## 协议

- Base URL 默认 `https://service-3347642c.example.invalid/v1`；渠道可以使用自己的兼容网关地址。
- `Authorization: Bearer <API Key>`；密钥只从渠道配置获取。
- `POST /v1/midjourney/generations`，新版路由自动注入 `model=midjourney`。
- 默认 `version=8.2`；其它已验证主版本需在 `providerOptions.apimart-midjourney.version` 中显式指定。Niji 需同时指定 `niji=true` 和 `version=7/6`。
- 创建响应读取 `data[0].task_id`；`GET /v1/tasks/{task_id}` 轮询 `pending/processing/completed/failed`。完成时读取 `result.images[].url`，保存所有图片；失败保留 `fail_reason`。
- 未声明取消、放大、变体、Edits 等其它操作。它们各有独立端点和参数合同，不由 Imagine 协议代发。

## 宿主字段映射

| 宿主输入 | 上游请求 | 说明 |
| --- | --- | --- |
| `model=midjourney` | 路由注入 | 校验模型 ID，body 不发送 `model`。 |
| `prompt` | `prompt` | 原样发送。 |
| `images` | `image_urls` | 最多 20 张 URL 或 data URL；不发送蒙版。 |
| `aspectRatio` | `size` | `auto` 或空值时省略。 |
| `quality` | `quality` | 仅 `0.25`、`0.5`、`1`、`2`；`auto` 时省略。 |
| `providerOptions.apimart-midjourney` | 同名 APIMart 字段 | 支持 `version`、`speed`、`negative_prompt`、`stylize`、`chaos`、`weird`、`seed`、`style`、`tile`、`niji`、`iw`、`cw`、`sw`、`cref`、`sref`、`dref`、`dw`、`repeat`、`raw`、`draft`、`hd`、`stop`、`nsfw_check`、`extra`、`metadata`。 |

APIMart 的 body 字段优先于 prompt 中的同名 Midjourney flag。`speed` 可选 `relax`、`fast`、`turbo`；未指定时沿用上游默认 `relax`。`hd` 只适用于 8.1/8.2。上游价格随 action、version、speed 变化，后台价格规格需单独配置，插件不计算零售价。

结果 URL 具有时效性，插件标记为临时媒体，由宿主保存后交付；不会将任务提交成功误报为图片已交付。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "apimart-midjourney",
  "name": "APIMart Midjourney",
  "version": "1.0.0",
  "author": "APIMart / 影绘",
  "description": "按 APIMart Imagine 异步任务协议生成和保存 Midjourney 图片。",
  "enabled": true,
  "installable": true,
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
        "id": "apimart-midjourney",
        "label": "APIMart Midjourney Imagine",
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
        "baseUrl": "https://service-3347642c.example.invalid/v1",
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
              "midjourney"
            ],
            "mapping": "route-injected model=midjourney",
            "description": "APIMart 的 Midjourney 模型 ID；新版路由自动注入，不在 body 重复发送。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "原样发送；可包含 APIMart 支持的 Midjourney prompt flags。"
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image_urls",
            "description": "Imagine 垫图，最多 20 张 URL 或 data URL；不接收蒙版。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "mapping": "size",
            "description": "宽高比；auto 或空值不发送。"
          },
          {
            "name": "quality",
            "type": "string",
            "values": [
              "0.25",
              "0.5",
              "1",
              "2"
            ],
            "mapping": "quality",
            "description": "上游 --q；auto 或空值不发送。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "apimart-midjourney.*",
            "description": "version、speed、negative_prompt、stylize、chaos、weird、seed、style、tile、niji、iw、cw、sw、cref、sref、dref、dw、repeat、raw、draft、hd、stop、nsfw_check、extra、metadata；按 APIMart Imagine 文档命名。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.model"
                },
                "midjourney"
              ]
            },
            "message": "APIMart Midjourney 模型 ID 必须为 midjourney。"
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
            "message": "Midjourney prompt 不能为空。"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$ref": "request.imageCount"
                },
                1
              ]
            },
            "message": "Imagine 一次只能提交一个任务；返回的图片会全部保存。"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.images"
                  }
                },
                20
              ]
            },
            "message": "APIMart Imagine 最多接收 20 张垫图。"
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
            "message": "Imagine 不接收蒙版；请使用 APIMart Edits 操作。"
          },
          {
            "assert": {
              "$in": [
                {
                  "$coalesce": [
                    {
                      "$ref": "request.providerOptions.apimart-midjourney.version"
                    },
                    "8.2"
                  ]
                },
                [
                  "8.2",
                  "8.1",
                  "7",
                  "6.1",
                  "5.2",
                  "5.1",
                  "6"
                ]
              ]
            },
            "message": "Midjourney version 必须是 APIMart 已支持的主版本，Niji 需配合 niji=true。"
          },
          {
            "assert": {
              "$in": [
                {
                  "$coalesce": [
                    {
                      "$ref": "request.providerOptions.apimart-midjourney.speed"
                    },
                    "relax"
                  ]
                },
                [
                  "relax",
                  "fast",
                  "turbo"
                ]
              ]
            },
            "message": "Midjourney speed 只支持 relax、fast 或 turbo。"
          },
          {
            "assert": {
              "$in": [
                {
                  "$coalesce": [
                    {
                      "$ref": "request.quality"
                    },
                    "auto"
                  ]
                },
                [
                  "auto",
                  "0.25",
                  "0.5",
                  "1",
                  "2"
                ]
              ]
            },
            "message": "Midjourney quality 只支持 0.25、0.5、1 或 2。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "request.providerOptions.apimart-midjourney.hd"
                    },
                    null
                  ]
                },
                {
                  "$eq": [
                    {
                      "$ref": "request.providerOptions.apimart-midjourney.hd"
                    },
                    false
                  ]
                },
                {
                  "$in": [
                    {
                      "$coalesce": [
                        {
                          "$ref": "request.providerOptions.apimart-midjourney.version"
                        },
                        "8.2"
                      ]
                    },
                    [
                      "8.2",
                      "8.1"
                    ]
                  ]
                }
              ]
            },
            "message": "HD 仅适用于 Midjourney 8.1 / 8.2。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$ne": [
                    {
                      "$ref": "request.providerOptions.apimart-midjourney.niji"
                    },
                    true
                  ]
                },
                {
                  "$in": [
                    {
                      "$coalesce": [
                        {
                          "$ref": "request.providerOptions.apimart-midjourney.version"
                        },
                        "8.2"
                      ]
                    },
                    [
                      "7",
                      "6"
                    ]
                  ]
                }
              ]
            },
            "message": "Niji 只支持 version=7 或 6。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$ne": [
                    {
                      "$ref": "request.providerOptions.apimart-midjourney.version"
                    },
                    "6"
                  ]
                },
                {
                  "$eq": [
                    {
                      "$ref": "request.providerOptions.apimart-midjourney.niji"
                    },
                    true
                  ]
                }
              ]
            },
            "message": "version=6 仅供 Niji 6 使用。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$ne": [
                    {
                      "$ref": "request.providerOptions.apimart-midjourney.draft"
                    },
                    true
                  ]
                },
                {
                  "$in": [
                    {
                      "$coalesce": [
                        {
                          "$ref": "request.providerOptions.apimart-midjourney.version"
                        },
                        "8.2"
                      ]
                    },
                    [
                      "8.2",
                      "8.1",
                      "7"
                    ]
                  ]
                }
              ]
            },
            "message": "Draft 仅适用于 Midjourney 7 及以上。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "request.providerOptions.apimart-midjourney.repeat"
                    },
                    null
                  ]
                },
                {
                  "$and": [
                    {
                      "$gte": [
                        {
                          "$ref": "request.providerOptions.apimart-midjourney.repeat"
                        },
                        2
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$ref": "request.providerOptions.apimart-midjourney.repeat"
                        },
                        40
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "repeat 必须在 2–40 之间。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "request.providerOptions.apimart-midjourney.stylize"
                    },
                    null
                  ]
                },
                {
                  "$and": [
                    {
                      "$gte": [
                        {
                          "$ref": "request.providerOptions.apimart-midjourney.stylize"
                        },
                        0
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$ref": "request.providerOptions.apimart-midjourney.stylize"
                        },
                        1000
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "stylize 必须在 0–1000 之间。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "request.providerOptions.apimart-midjourney.chaos"
                    },
                    null
                  ]
                },
                {
                  "$and": [
                    {
                      "$gte": [
                        {
                          "$ref": "request.providerOptions.apimart-midjourney.chaos"
                        },
                        0
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$ref": "request.providerOptions.apimart-midjourney.chaos"
                        },
                        100
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "chaos 必须在 0–100 之间。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "request.providerOptions.apimart-midjourney.weird"
                    },
                    null
                  ]
                },
                {
                  "$and": [
                    {
                      "$gte": [
                        {
                          "$ref": "request.providerOptions.apimart-midjourney.weird"
                        },
                        0
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$ref": "request.providerOptions.apimart-midjourney.weird"
                        },
                        3000
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "weird 必须在 0–3000 之间。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "request.providerOptions.apimart-midjourney.iw"
                    },
                    null
                  ]
                },
                {
                  "$and": [
                    {
                      "$gte": [
                        {
                          "$ref": "request.providerOptions.apimart-midjourney.iw"
                        },
                        0
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$ref": "request.providerOptions.apimart-midjourney.iw"
                        },
                        3
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
                    }
                  ]
                }
              ]
            },
            "message": "iw 必须在 0–3 之间，并且需要 image_urls。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "request.providerOptions.apimart-midjourney.stop"
                    },
                    null
                  ]
                },
                {
                  "$and": [
                    {
                      "$gte": [
                        {
                          "$ref": "request.providerOptions.apimart-midjourney.stop"
                        },
                        10
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$ref": "request.providerOptions.apimart-midjourney.stop"
                        },
                        100
                      ]
                    },
                    {
                      "$in": [
                        {
                          "$ref": "request.providerOptions.apimart-midjourney.version"
                        },
                        [
                          "5.1",
                          "5.2",
                          "6.1",
                          "6"
                        ]
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "stop 仅适用于 5.1、5.2、6.1 或 Niji 6，范围 10–100。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/midjourney/generations",
          "contentType": "application/json",
          "body": {
            "prompt": {
              "$ref": "request.prompt"
            },
            "image_urls": {
              "$if": {
                "condition": {
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
                },
                "else": null
              }
            },
            "size": {
              "$if": {
                "condition": {
                  "$in": [
                    {
                      "$lower": {
                        "$trim": {
                          "$ref": "request.aspectRatio"
                        }
                      }
                    },
                    [
                      "",
                      "auto"
                    ]
                  ]
                },
                "then": null,
                "else": {
                  "$ref": "request.aspectRatio"
                }
              }
            },
            "quality": {
              "$if": {
                "condition": {
                  "$in": [
                    {
                      "$lower": {
                        "$trim": {
                          "$ref": "request.quality"
                        }
                      }
                    },
                    [
                      "",
                      "auto"
                    ]
                  ]
                },
                "then": null,
                "else": {
                  "$ref": "request.quality"
                }
              }
            },
            "version": {
              "$coalesce": [
                {
                  "$ref": "request.providerOptions.apimart-midjourney.version"
                },
                "8.2"
              ]
            },
            "speed": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.apimart-midjourney.speed"
              }
            },
            "negative_prompt": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.apimart-midjourney.negative_prompt"
              }
            },
            "stylize": {
              "$ref": "request.providerOptions.apimart-midjourney.stylize"
            },
            "chaos": {
              "$ref": "request.providerOptions.apimart-midjourney.chaos"
            },
            "weird": {
              "$ref": "request.providerOptions.apimart-midjourney.weird"
            },
            "seed": {
              "$ref": "request.providerOptions.apimart-midjourney.seed"
            },
            "style": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.apimart-midjourney.style"
              }
            },
            "tile": {
              "$ref": "request.providerOptions.apimart-midjourney.tile"
            },
            "niji": {
              "$ref": "request.providerOptions.apimart-midjourney.niji"
            },
            "iw": {
              "$ref": "request.providerOptions.apimart-midjourney.iw"
            },
            "cw": {
              "$ref": "request.providerOptions.apimart-midjourney.cw"
            },
            "sw": {
              "$ref": "request.providerOptions.apimart-midjourney.sw"
            },
            "cref": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.apimart-midjourney.cref"
              }
            },
            "sref": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.apimart-midjourney.sref"
              }
            },
            "dref": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.apimart-midjourney.dref"
              }
            },
            "dw": {
              "$ref": "request.providerOptions.apimart-midjourney.dw"
            },
            "repeat": {
              "$ref": "request.providerOptions.apimart-midjourney.repeat"
            },
            "raw": {
              "$ref": "request.providerOptions.apimart-midjourney.raw"
            },
            "draft": {
              "$ref": "request.providerOptions.apimart-midjourney.draft"
            },
            "hd": {
              "$ref": "request.providerOptions.apimart-midjourney.hd"
            },
            "stop": {
              "$ref": "request.providerOptions.apimart-midjourney.stop"
            },
            "nsfw_check": {
              "$ref": "request.providerOptions.apimart-midjourney.nsfw_check"
            },
            "extra": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.apimart-midjourney.extra"
              }
            },
            "metadata": {
              "$ref": "request.providerOptions.apimart-midjourney.metadata"
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
            "task_id",
            "id"
          ],
          "statusPaths": [
            "data.0.status",
            "data.status",
            "status"
          ],
          "errorPaths": [
            "data.error.code",
            "error.code",
            "error.type"
          ],
          "messagePaths": [
            "data.error.message",
            "fail_reason",
            "error.message",
            "message"
          ],
          "images": {
            "$coalesce": [
              {
                "$ref": "response.data.result.images"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_urls"
              }
            ]
          },
          "resultEphemeral": true,
          "usage": {
            "$coalesce": [
              {
                "$ref": "response.data.usage"
              },
              {
                "$ref": "response.usage"
              }
            ]
          }
        }
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
