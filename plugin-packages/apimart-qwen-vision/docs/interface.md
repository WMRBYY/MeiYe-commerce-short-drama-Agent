# APIMart Qwen 图文理解接口

- 采用 [APIMart 通用对话接口](https://service-3778997d.example.invalid/cn/api-reference/texts/general/chat-completions-nostream) 的 OpenAI 兼容格式；[Qwen 官方视觉文档](https://service-65d808da.example.invalid/developer-guides/multimodal/vision)也展示该格式的图片输入。APIMart 是否提供具体 Qwen 模型及图片路由，需要以其实际模型列表和请求结果核实。
- 默认 Base URL 为 `https://service-3347642c.example.invalid/v1`；Bearer API Key 保存在服务端。调用 `POST /chat/completions`，图片使用 `messages` 内的 `image_url` 内容块，显式发送 `stream: false`。
- 添加文本模型时选择“APIMart Qwen 图文理解”，上游模型 ID 以 APIMart 控制台实际提供的 ID 为准，例如待核对的 `qwen3.6-flash`。在能力与参数中配置图片输入数量和大小，并配置价格。
- Qwen 官方模型支持图片不代表 APIMart 当前渠道一定开通该模型或支持所有图片格式。通过真实账号验证前，不应将请求映射测试当作真实识图验收。
- 此插件不自动启用上下文缓存；不支持流式增量和思考模式。Agent 使用非流式 Chat Completions 工具格式。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "apimart-qwen-vision",
  "name": "APIMart Qwen 图文理解",
  "version": "2.0.0",
  "author": "MeiyeAI",
  "description": "APIMart OpenAI 兼容对话协议，用于 Qwen 图文理解。",
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
        "id": "apimart-qwen-vision",
        "label": "APIMart Qwen 图文理解",
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
            "mapping": "model",
            "description": "上游模型 ID。"
          },
          {
            "name": "messages",
            "type": "message[]",
            "required": true,
            "mapping": "provider message container",
            "description": "包含历史消息和当前用户输入。"
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
          "path": "/chat/completions",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "messages": {
              "$ref": "request.messages"
            },
            "temperature": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.apimart-qwen-vision.temperature"
              }
            },
            "top_p": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.apimart-qwen-vision.top_p"
              }
            },
            "max_tokens": {
              "$omitEmpty": {
                "$coalesce": [
                  {
                    "$ref": "request.extra.max_tokens"
                  },
                  {
                    "$ref": "request.providerOptions.apimart-qwen-vision.max_tokens"
                  }
                ]
              }
            },
            "tools": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.apimart-qwen-vision.tools"
              }
            },
            "tool_choice": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.apimart-qwen-vision.tool_choice"
              }
            },
            "response_format": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.apimart-qwen-vision.response_format"
              }
            },
            "stream": false,
            "stop": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.apimart-qwen-vision.stop"
              }
            },
            "seed": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.apimart-qwen-vision.seed"
              }
            },
            "frequency_penalty": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.apimart-qwen-vision.frequency_penalty"
              }
            },
            "presence_penalty": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.apimart-qwen-vision.presence_penalty"
              }
            },
            "logprobs": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.apimart-qwen-vision.logprobs"
              }
            },
            "top_logprobs": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.apimart-qwen-vision.top_logprobs"
              }
            },
            "user": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.apimart-qwen-vision.user"
              }
            }
          }
        },
        "agent": {
          "method": "POST",
          "path": "/chat/completions",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "$ref": "request.extra.agent.chatCompletion"
              },
              {
                "model": {
                  "$ref": "request.model"
                }
              },
              {
                "stream": false
              }
            ]
          }
        },
        "response": {
          "status": "succeeded",
          "textPaths": [
            "choices.0.message.content",
            "choices.0.text"
          ],
          "reasoningPaths": [
            "choices.0.message.reasoning_content"
          ],
          "usage": {
            "$ref": "response.usage"
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
            "choices.0.message.content",
            "choices.0.text"
          ],
          "reasoningPaths": [
            "choices.0.message.reasoning_content"
          ],
          "toolCallsPath": "choices.0.message.tool_calls",
          "toolCallIdPaths": [
            "id"
          ],
          "toolCallNamePaths": [
            "function.name"
          ],
          "toolCallArgumentsPaths": [
            "function.arguments"
          ]
        }
      }
    ]
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
