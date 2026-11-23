# 接口与媒体输入

- Provider ID：`gemini-multimodal-text`；能力：`text`。
- 默认地址：`https://generativelanguage.googleapis.com`。
- POST `/v1beta/models/{model}:generateContent`；配置 apiKey，使用 `x-goog-api-key` 鉴权。
- 支持普通文本、历史消息、系统指令及图片/视频/音频多模态消息。
- `data:<mime>;base64,...` 转换为 `inlineData`，保留真实 MIME；URL 转换为 `fileData.fileUri`。URL 消息可设置 `mimeType` 或 `mime_type`，默认图片 image/jpeg、视频 video/mp4、音频 audio/mpeg。
- 远程文件须为上游可访问且支持的地址；Google Files URI 须已处理完成。网关是否支持普通 HTTP 媒体地址取决于其实现。此协议不自动上传到 Google Files API。较大文件请先使用 Files API；内联请求建议总大小不超过 20 MB。
- `providerOptions.gemini-multimodal-text` 支持 generationConfig、safetySettings、tools、toolConfig、cachedContent。统一 max_output_tokens 映射为 maxOutputTokens。
- 响应同步返回 candidates 文本和 usageMetadata；过滤 thought 部分；上游错误保持失败语义。无逐 token SSE 输出。
- Agent 使用宿主构造的原生 Gemini 请求，保留工具调用与 thoughtSignature。

参考：[Google 视频理解](https://ai.google.dev/gemini-api/docs/video-understanding)。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "google-gemini-multimodal-text",
  "name": "Gemini 多模态文本识别",
  "version": "1.0.0",
  "author": "Google / MeiyeAI",
  "description": "Gemini 原生文本、视频理解与图片文字识别协议。",
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
        "id": "gemini-multimodal-text",
        "label": "Gemini 多模态文本识别（视频 / 图片 OCR）",
        "capabilities": [
          "text"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://generativelanguage.googleapis.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "google-api-key",
          "field": "apiKey"
        },
        "parameters": [
          {
            "name": "model",
            "type": "string",
            "required": true,
            "mapping": "model",
            "description": "上游模型 ID。"
          },
          {
            "name": "messages",
            "type": "message[]",
            "required": true,
            "mapping": "provider message container",
            "description": "文本或 text/image_url/video_url/audio_url 多模态消息；data URL 转 inlineData，远程地址转 fileData。"
          },
          {
            "name": "instructions",
            "type": "string",
            "required": false,
            "mapping": "system/instructions",
            "description": "系统指令。"
          },
          {
            "name": "temperature",
            "type": "number",
            "required": false,
            "mapping": "temperature",
            "description": "采样温度。"
          },
          {
            "name": "top_p",
            "type": "number",
            "required": false,
            "mapping": "top_p",
            "description": "核采样参数。"
          },
          {
            "name": "max_tokens",
            "type": "integer",
            "required": false,
            "mapping": "max_tokens/max_output_tokens",
            "description": "最大输出 token。"
          },
          {
            "name": "tools",
            "type": "array",
            "required": false,
            "mapping": "tools/toolConfig",
            "description": "工具定义。"
          },
          {
            "name": "tool_choice",
            "type": "object|string",
            "required": false,
            "mapping": "tool_choice",
            "description": "工具选择策略。"
          },
          {
            "name": "response_format",
            "type": "object",
            "required": false,
            "mapping": "response_format/text",
            "description": "结构化输出配置。"
          },
          {
            "name": "stream",
            "type": "boolean",
            "required": false,
            "mapping": "stream",
            "description": "流式开关；后台任务当前以最终响应归一。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1beta/models/{{model}}:generateContent",
          "contentType": "application/json",
          "body": {
            "contents": {
              "$map": {
                "from": {
                  "$filter": {
                    "from": {
                      "$ref": "request.messages"
                    },
                    "as": "message",
                    "where": {
                      "$ne": [
                        {
                          "$ref": "message.role"
                        },
                        "system"
                      ]
                    }
                  }
                },
                "as": "message",
                "in": {
                  "role": {
                    "$if": {
                      "condition": {
                        "$eq": [
                          {
                            "$ref": "message.role"
                          },
                          "assistant"
                        ]
                      },
                      "then": "model",
                      "else": "user"
                    }
                  },
                  "parts": {
                    "$if": {
                      "condition": {
                        "$ref": "message.content.0.type"
                      },
                      "then": {
                        "$map": {
                          "from": {
                            "$ref": "message.content"
                          },
                          "as": "part",
                          "in": {
                            "$if": {
                              "condition": {
                                "$eq": [
                                  {
                                    "$ref": "part.type"
                                  },
                                  "text"
                                ]
                              },
                              "then": {
                                "text": {
                                  "$ref": "part.text"
                                }
                              },
                              "else": {
                                "$if": {
                                  "condition": {
                                    "$eq": [
                                      {
                                        "$first": {
                                          "$split": [
                                            {
                                              "$coalesce": [
                                                {
                                                  "$ref": "part.image_url.url"
                                                },
                                                {
                                                  "$ref": "part.video_url.url"
                                                },
                                                {
                                                  "$ref": "part.audio_url.url"
                                                }
                                              ]
                                            },
                                            ":"
                                          ]
                                        }
                                      },
                                      "data"
                                    ]
                                  },
                                  "then": {
                                    "inlineData": {
                                      "mimeType": {
                                        "$dataMime": {
                                          "$coalesce": [
                                            {
                                              "$ref": "part.image_url.url"
                                            },
                                            {
                                              "$ref": "part.video_url.url"
                                            },
                                            {
                                              "$ref": "part.audio_url.url"
                                            }
                                          ]
                                        }
                                      },
                                      "data": {
                                        "$dataPayload": {
                                          "$coalesce": [
                                            {
                                              "$ref": "part.image_url.url"
                                            },
                                            {
                                              "$ref": "part.video_url.url"
                                            },
                                            {
                                              "$ref": "part.audio_url.url"
                                            }
                                          ]
                                        }
                                      }
                                    }
                                  },
                                  "else": {
                                    "fileData": {
                                      "mimeType": {
                                        "$coalesce": [
                                          {
                                            "$ref": "part.mimeType"
                                          },
                                          {
                                            "$ref": "part.mime_type"
                                          },
                                          {
                                            "$switch": {
                                              "cases": [
                                                {
                                                  "when": {
                                                    "$eq": [
                                                      {
                                                        "$ref": "part.type"
                                                      },
                                                      "image_url"
                                                    ]
                                                  },
                                                  "then": "image/jpeg"
                                                },
                                                {
                                                  "when": {
                                                    "$eq": [
                                                      {
                                                        "$ref": "part.type"
                                                      },
                                                      "audio_url"
                                                    ]
                                                  },
                                                  "then": "audio/mpeg"
                                                }
                                              ],
                                              "default": "video/mp4"
                                            }
                                          }
                                        ]
                                      },
                                      "fileUri": {
                                        "$coalesce": [
                                          {
                                            "$ref": "part.image_url.url"
                                          },
                                          {
                                            "$ref": "part.video_url.url"
                                          },
                                          {
                                            "$ref": "part.audio_url.url"
                                          }
                                        ]
                                      }
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      },
                      "else": [
                        {
                          "text": {
                            "$ref": "message.content"
                          }
                        }
                      ]
                    }
                  }
                }
              }
            },
            "systemInstruction": {
              "$if": {
                "condition": {
                  "$ref": "request.instructions"
                },
                "then": {
                  "parts": [
                    {
                      "text": {
                        "$ref": "request.instructions"
                      }
                    }
                  ]
                },
                "else": null
              }
            },
            "generationConfig": {
              "$merge": [
                {
                  "maxOutputTokens": {
                    "$omitEmpty": {
                      "$ref": "request.extra.max_output_tokens"
                    }
                  }
                },
                {
                  "$coalesce": [
                    {
                      "$ref": "request.providerOptions.gemini-multimodal-text.generationConfig"
                    },
                    {}
                  ]
                }
              ]
            },
            "safetySettings": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.gemini-multimodal-text.safetySettings"
              }
            },
            "tools": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.gemini-multimodal-text.tools"
              }
            },
            "toolConfig": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.gemini-multimodal-text.toolConfig"
              }
            },
            "cachedContent": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.gemini-multimodal-text.cachedContent"
              }
            }
          }
        },
        "agent": {
          "method": "POST",
          "path": "/v1beta/models/{{model}}:generateContent",
          "contentType": "application/json",
          "body": {
            "$ref": "request.extra.agent.gemini"
          }
        },
        "response": {
          "status": "succeeded",
          "text": {
            "$map": {
              "from": {
                "$filter": {
                  "from": {
                    "$ref": "response.candidates.0.content.parts"
                  },
                  "as": "candidatePart",
                  "where": {
                    "$ne": [
                      {
                        "$ref": "candidatePart.thought"
                      },
                      true
                    ]
                  }
                }
              },
              "as": "part",
              "in": {
                "$omitEmpty": {
                  "$ref": "part.text"
                }
              }
            }
          },
          "usage": {
            "$ref": "response.usageMetadata"
          },
          "errorPaths": [
            "error.code"
          ],
          "messagePaths": [
            "error.message"
          ]
        },
        "agentResponse": {
          "textPaths": [
            "candidates.0.content.parts.0.text"
          ],
          "toolCallsPath": "candidates.0.content.parts",
          "toolCallIdPaths": [
            "functionCall.id"
          ],
          "toolCallNamePaths": [
            "functionCall.name"
          ],
          "toolCallArgumentsPaths": [
            "functionCall.args"
          ],
          "toolCallThoughtSignaturePaths": [
            "thoughtSignature",
            "thought_signature"
          ]
        }
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
