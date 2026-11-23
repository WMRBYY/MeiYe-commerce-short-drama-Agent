# Bria 接口字段与响应

`apiKey` 是服务端保存的 Bria token，请求以 `api_token` Header 鉴权。

统一参数 `prompt`、`images`、`providerOptions` 映射到各端点的具体字段；端点特有字段通过对应协议的 `providerOptions.<protocol-id>.body` 提供。v2 响应读取 `request_id`、`status`、`result.image_url` 或 `result.video_url`，然后轮询 `/v2/status/{request_id}`。媒体结果由宿主及时下载持久化，错误响应保持失败。

视频换背景和视频提升分辨率要求供应商能访问输入视频的公网 URL；这两个协议会从受权限校验的资源生成临时 URL。画布节点按输入视频实际时长计费，最多 60 秒。

Bria API 目录：

- `/v1/product/contextual_keyword_extraction` · Contextual Keyword Extraction (Coming Soon) · https://docs.bria.ai/product-shot-editing
- `/v1/product/cutout` · Product Cutout · https://docs.bria.ai/product-shot-editing
- `/v1/product/lifestyle_shot_by_image` · Lifestyle Product Shot by Image · https://docs.bria.ai/product-shot-editing
- `/v1/product/lifestyle_shot_by_text` · Lifestyle Product Shot by Text · https://docs.bria.ai/product-shot-editing
- `/v1/product/packshot` · Product Packshot · https://docs.bria.ai/product-shot-editing
- `/v1/product/shadow` · Product Shadow · https://docs.bria.ai/product-shot-editing
- `/v1/product/vehicle/apply_effect` · Apply Effects · https://docs.bria.ai/product-shot-editing
- `/v1/product/vehicle/generate_reflections` · Reflections · https://docs.bria.ai/product-shot-editing
- `/v1/product/vehicle/harmonize` · Harmonization · https://docs.bria.ai/product-shot-editing
- `/v1/product/vehicle/refine_tires` · Tires Refinement · https://docs.bria.ai/product-shot-editing
- `/v1/product/vehicle/segment` · Segmentation · https://docs.bria.ai/product-shot-editing
- `/v1/product/vehicle/shot_by_image` · Vehicle Shot by Image (Coming soon) · https://docs.bria.ai/product-shot-editing
- `/v1/product/vehicle/shot_by_text` · Vehicle Shot by text · https://docs.bria.ai/product-shot-editing
- `/v1/products/consistent_shots` · Consistent Product Shots (Coming Soon) · https://docs.bria.ai/product-shot-editing
- `/v2/ads/delayer` · Decompose an ad into layers · https://docs.bria.ai/ads
- `/v2/ads/resize` · Resize an ad into other sizes · https://docs.bria.ai/ads
- `/v2/image/edit` · Image Edit by Text · https://docs.bria.ai/image-editing
- `/v2/image/edit/add_object_by_text` · Add Object by Text · https://docs.bria.ai/image-editing
- `/v2/image/edit/blend` · Image Blending · https://docs.bria.ai/image-editing
- `/v2/image/edit/blur_background` · Blur Background · https://docs.bria.ai/image-editing
- `/v2/image/edit/colorize` · Colorize · https://docs.bria.ai/image-editing
- `/v2/image/edit/crop_foreground` · Crop out foreground · https://docs.bria.ai/image-editing
- `/v2/image/edit/enhance` · Enhance Image · https://docs.bria.ai/image-editing
- `/v2/image/edit/erase` · Eraser · https://docs.bria.ai/image-editing
- `/v2/image/edit/erase_by_text` · Erase Object by Text · https://docs.bria.ai/image-editing
- `/v2/image/edit/erase_foreground` · Erase Foreground · https://docs.bria.ai/image-editing
- `/v2/image/edit/expand` · Expand Image · https://docs.bria.ai/image-editing
- `/v2/image/edit/gen_fill` · Generative Fill · https://docs.bria.ai/image-editing
- `/v2/image/edit/increase_resolution` · Increase Resolution · https://docs.bria.ai/image-editing
- `/v2/image/edit/product/cutout` · Product Cutout (v2) · https://docs.bria.ai/product-shot-editing
- `/v2/image/edit/product/holding` · Product Holding · https://docs.bria.ai/product-shot-editing
- `/v2/image/edit/product/integrate` · Embed products into a scene · https://docs.bria.ai/product-shot-editing
- `/v2/image/edit/product/virtual-tryon` · Virtual Try-On · https://docs.bria.ai/product-shot-editing
- `/v2/image/edit/relight` · Relight Image · https://docs.bria.ai/image-editing
- `/v2/image/edit/remove_background` · Remove Background · https://docs.bria.ai/image-editing
- `/v2/image/edit/remove_background/guided` · Guided Remove Background · https://docs.bria.ai/image-editing
- `/v2/image/edit/replace_background` · Replace Background · https://docs.bria.ai/image-editing
- `/v2/image/edit/replace_object_by_text` · Replace Object by Text · https://docs.bria.ai/image-editing
- `/v2/image/edit/reseason` · Reseason Image · https://docs.bria.ai/image-editing
- `/v2/image/edit/restore` · Restore Old Images · https://docs.bria.ai/image-editing
- `/v2/image/edit/restyle` · Restyle Image · https://docs.bria.ai/image-editing
- `/v2/image/edit/rewrite_text` · Rewrite · https://docs.bria.ai/image-editing
- `/v2/image/edit/sketch_to_colored_image` · Sketch to Image · https://docs.bria.ai/image-editing
- `/v2/image/generate` · Generate Image · https://docs.bria.ai/image-generation
- `/v2/image/generate/lite` · Generate Image - Lite · https://docs.bria.ai/image-generation
- `/v2/image/segment/all_masks` · Generate all masks · https://docs.bria.ai/image-editing
- `/v2/structured_instruction/generate` · Generate Structured Instruction · https://docs.bria.ai/image-editing
- `/v2/structured_prompt/generate` · Generate Structured Prompt · https://docs.bria.ai/image-generation
- `/v2/structured_prompt/generate/lite` · Generate Structured Prompt - Lite · https://docs.bria.ai/image-generation
- `/v2/structured_prompt/generate_from_diff` · Generate Structured Prompt from Diff · https://docs.bria.ai/image-generation
- `/v2/video/edit/erase` · Eraser · https://docs.bria.ai/video-editing
- `/v2/video/edit/green_screen` · Green Screen · https://docs.bria.ai/video-editing
- `/v2/video/edit/increase_resolution` · Increase Resolution - up to 8K · https://docs.bria.ai/video-editing
- `/v2/video/edit/remove_background` · Remove Background · https://docs.bria.ai/video-editing
- `/v2/video/edit/replace_background` · Replace Background · https://docs.bria.ai/video-editing
- `/v2/video/generate/foreground_mask` · Foreground Mask · https://docs.bria.ai/video-editing
- `/v2/video/segment/mask_by_key_points` · Generate Mask by Key Points · https://docs.bria.ai/video-editing
- `/v2/video/segment/mask_by_prompt` · Generate Mask by Prompt · https://docs.bria.ai/video-editing

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "bria-visual-api",
  "name": "Bria Visual API",
  "version": "1.0.0",
  "author": "Bria / MeiyeAI",
  "description": "Bria official REST visual operations, with per-endpoint request schemas.",
  "permissions": [
    "generation.run",
    "media.read"
  ],
  "configuration": {
    "fields": [
      {
        "name": "apiKey",
        "type": "secret",
        "label": "Bria API token",
        "required": true
      }
    ]
  },
  "contributes": {
    "providers": [
      {
        "id": "bria-v2-image-generate",
        "label": "Generate Image",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "prompt",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-image-generate.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/image/generate",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "prompt": {
                  "$omitEmpty": {
                    "$ref": "request.prompt"
                  }
                },
                "images": {
                  "$omitEmpty": {
                    "$map": {
                      "from": {
                        "$ref": "request.images"
                      },
                      "as": "media",
                      "in": {
                        "$dataPayload": {
                          "$ref": "media.value"
                        }
                      }
                    }
                  }
                },
                "resolution": {
                  "$omitEmpty": {
                    "$ref": "request.resolution"
                  }
                },
                "aspect_ratio": {
                  "$omitEmpty": {
                    "$ref": "request.aspectRatio"
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-image-generate.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-image-generate-lite",
        "label": "Generate Image - Lite",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "prompt",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-image-generate-lite.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/image/generate/lite",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "prompt": {
                  "$omitEmpty": {
                    "$ref": "request.prompt"
                  }
                },
                "images": {
                  "$omitEmpty": {
                    "$map": {
                      "from": {
                        "$ref": "request.images"
                      },
                      "as": "media",
                      "in": {
                        "$dataPayload": {
                          "$ref": "media.value"
                        }
                      }
                    }
                  }
                },
                "aspect_ratio": {
                  "$omitEmpty": {
                    "$ref": "request.aspectRatio"
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-image-generate-lite.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-structured-prompt-generate",
        "label": "Generate Structured Prompt",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "prompt",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-structured-prompt-generate.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/structured_prompt/generate",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "prompt": {
                  "$omitEmpty": {
                    "$ref": "request.prompt"
                  }
                },
                "images": {
                  "$omitEmpty": {
                    "$map": {
                      "from": {
                        "$ref": "request.images"
                      },
                      "as": "media",
                      "in": {
                        "$dataPayload": {
                          "$ref": "media.value"
                        }
                      }
                    }
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-structured-prompt-generate.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "text": {
            "$if": {
              "condition": {
                "$ref": "response.result"
              },
              "then": {
                "$json": {
                  "$ref": "response.result"
                }
              },
              "else": ""
            }
          }
        }
      },
      {
        "id": "bria-v2-structured-prompt-generate-from-diff",
        "label": "Generate Structured Prompt from Diff",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "providerOptions",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-structured-prompt-generate-from-diff.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/structured_prompt/generate_from_diff",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {},
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-structured-prompt-generate-from-diff.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "text": {
            "$if": {
              "condition": {
                "$ref": "response.result"
              },
              "then": {
                "$json": {
                  "$ref": "response.result"
                }
              },
              "else": ""
            }
          }
        }
      },
      {
        "id": "bria-v2-structured-prompt-generate-lite",
        "label": "Generate Structured Prompt - Lite",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "prompt",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-structured-prompt-generate-lite.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/structured_prompt/generate/lite",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "prompt": {
                  "$omitEmpty": {
                    "$ref": "request.prompt"
                  }
                },
                "images": {
                  "$omitEmpty": {
                    "$map": {
                      "from": {
                        "$ref": "request.images"
                      },
                      "as": "media",
                      "in": {
                        "$dataPayload": {
                          "$ref": "media.value"
                        }
                      }
                    }
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-structured-prompt-generate-lite.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "text": {
            "$if": {
              "condition": {
                "$ref": "response.result"
              },
              "then": {
                "$json": {
                  "$ref": "response.result"
                }
              },
              "else": ""
            }
          }
        }
      },
      {
        "id": "bria-v2-image-edit",
        "label": "Image Edit by Text",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "instruction",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-image-edit.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/image/edit",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "images": {
                  "$omitEmpty": {
                    "$map": {
                      "from": {
                        "$ref": "request.images"
                      },
                      "as": "media",
                      "in": {
                        "$dataPayload": {
                          "$ref": "media.value"
                        }
                      }
                    }
                  }
                },
                "instruction": {
                  "$omitEmpty": {
                    "$ref": "request.prompt"
                  }
                },
                "mask": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$first": {
                        "$map": {
                          "from": {
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
                "aspect_ratio": {
                  "$omitEmpty": {
                    "$ref": "request.aspectRatio"
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-image-edit.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-structured-instruction-generate",
        "label": "Generate Structured Instruction",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "instruction",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": true
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-structured-instruction-generate.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/structured_instruction/generate",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "instruction": {
                  "$omitEmpty": {
                    "$ref": "request.prompt"
                  }
                },
                "images": {
                  "$omitEmpty": {
                    "$map": {
                      "from": {
                        "$ref": "request.images"
                      },
                      "as": "media",
                      "in": {
                        "$dataPayload": {
                          "$ref": "media.value"
                        }
                      }
                    }
                  }
                },
                "mask": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$first": {
                        "$map": {
                          "from": {
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
                          },
                          "as": "media",
                          "in": {
                            "$ref": "media.value"
                          }
                        }
                      }
                    }
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-structured-instruction-generate.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "text": {
            "$if": {
              "condition": {
                "$ref": "response.result"
              },
              "then": {
                "$json": {
                  "$ref": "response.result"
                }
              },
              "else": ""
            }
          }
        }
      },
      {
        "id": "bria-v2-image-edit-add-object-by-text",
        "label": "Add Object by Text",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "instruction",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": true
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-image-edit-add-object-by-text.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/image/edit/add_object_by_text",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "image": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                },
                "instruction": {
                  "$omitEmpty": {
                    "$ref": "request.prompt"
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-image-edit-add-object-by-text.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-image-edit-replace-object-by-text",
        "label": "Replace Object by Text",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "instruction",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": true
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-image-edit-replace-object-by-text.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/image/edit/replace_object_by_text",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "image": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                },
                "instruction": {
                  "$omitEmpty": {
                    "$ref": "request.prompt"
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-image-edit-replace-object-by-text.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-image-edit-erase-by-text",
        "label": "Erase Object by Text",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "providerOptions",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-image-edit-erase-by-text.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/image/edit/erase_by_text",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "image": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                },
                "object_name": {
                  "$omitEmpty": {
                    "$ref": "request.prompt"
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-image-edit-erase-by-text.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-image-edit-blend",
        "label": "Image Blending",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "instruction",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": true
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-image-edit-blend.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/image/edit/blend",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "image": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                },
                "instruction": {
                  "$omitEmpty": {
                    "$ref": "request.prompt"
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-image-edit-blend.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-image-edit-reseason",
        "label": "Reseason Image",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "providerOptions",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-image-edit-reseason.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/image/edit/reseason",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "image": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-image-edit-reseason.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-image-edit-rewrite-text",
        "label": "Rewrite",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "providerOptions",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-image-edit-rewrite-text.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/image/edit/rewrite_text",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "image": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-image-edit-rewrite-text.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-image-edit-sketch-to-colored-image",
        "label": "Sketch to Image",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "providerOptions",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-image-edit-sketch-to-colored-image.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/image/edit/sketch_to_colored_image",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "image": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-image-edit-sketch-to-colored-image.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-image-edit-restore",
        "label": "Restore Old Images",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "providerOptions",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-image-edit-restore.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/image/edit/restore",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "image": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-image-edit-restore.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-image-edit-colorize",
        "label": "Colorize",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "providerOptions",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-image-edit-colorize.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/image/edit/colorize",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "image": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-image-edit-colorize.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-image-edit-restyle",
        "label": "Restyle Image",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "providerOptions",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-image-edit-restyle.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/image/edit/restyle",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "image": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-image-edit-restyle.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-image-edit-relight",
        "label": "Relight Image",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "providerOptions",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-image-edit-relight.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/image/edit/relight",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "image": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-image-edit-relight.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-image-edit-erase",
        "label": "Eraser",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "providerOptions",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-image-edit-erase.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/image/edit/erase",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "image": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                },
                "mask": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$first": {
                        "$map": {
                          "from": {
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
                          },
                          "as": "media",
                          "in": {
                            "$ref": "media.value"
                          }
                        }
                      }
                    }
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-image-edit-erase.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-image-edit-gen-fill",
        "label": "Generative Fill",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "prompt",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": true
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-image-edit-gen-fill.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/image/edit/gen_fill",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "image": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                },
                "mask": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$first": {
                        "$map": {
                          "from": {
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
                "prompt": {
                  "$omitEmpty": {
                    "$ref": "request.prompt"
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-image-edit-gen-fill.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-image-edit-remove-background",
        "label": "Remove Background",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "prompt",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-image-edit-remove-background.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/image/edit/remove_background",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "image": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                },
                "prompt": {
                  "$omitEmpty": {
                    "$ref": "request.prompt"
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-image-edit-remove-background.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-image-edit-remove-background-guided",
        "label": "Guided Remove Background",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "prompt",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-image-edit-remove-background-guided.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/image/edit/remove_background/guided",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "image": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                },
                "prompt": {
                  "$omitEmpty": {
                    "$ref": "request.prompt"
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-image-edit-remove-background-guided.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-image-edit-replace-background",
        "label": "Replace Background",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "prompt",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-image-edit-replace-background.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/image/edit/replace_background",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "image": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                },
                "ref_images": {
                  "$omitEmpty": {
                    "$map": {
                      "from": {
                        "$filter": {
                          "from": {
                            "$ref": "request.images"
                          },
                          "as": "media",
                          "where": {
                            "$gt": [
                              {
                                "$ref": "mediaIndex"
                              },
                              0
                            ]
                          }
                        }
                      },
                      "as": "media",
                      "in": {
                        "$dataPayload": {
                          "$ref": "media.value"
                        }
                      }
                    }
                  }
                },
                "prompt": {
                  "$omitEmpty": {
                    "$ref": "request.prompt"
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-image-edit-replace-background.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-image-edit-erase-foreground",
        "label": "Erase Foreground",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "providerOptions",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-image-edit-erase-foreground.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/image/edit/erase_foreground",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "image": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-image-edit-erase-foreground.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-image-edit-blur-background",
        "label": "Blur Background",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "providerOptions",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-image-edit-blur-background.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/image/edit/blur_background",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "image": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-image-edit-blur-background.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-image-edit-expand",
        "label": "Expand Image",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "prompt",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-image-edit-expand.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/image/edit/expand",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "image": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                },
                "aspect_ratio": {
                  "$omitEmpty": {
                    "$ref": "request.aspectRatio"
                  }
                },
                "prompt": {
                  "$omitEmpty": {
                    "$ref": "request.prompt"
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-image-edit-expand.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-image-edit-enhance",
        "label": "Enhance Image",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "providerOptions",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-image-edit-enhance.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/image/edit/enhance",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "image": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-image-edit-enhance.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-image-edit-increase-resolution",
        "label": "Increase Resolution",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "providerOptions",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-image-edit-increase-resolution.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/image/edit/increase_resolution",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "image": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-image-edit-increase-resolution.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-image-edit-crop-foreground",
        "label": "Crop out foreground",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "providerOptions",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-image-edit-crop-foreground.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/image/edit/crop_foreground",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "image": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-image-edit-crop-foreground.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-image-segment-all-masks",
        "label": "Generate all masks",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "providerOptions",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-image-segment-all-masks.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/image/segment/all_masks",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "image": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-image-segment-all-masks.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v1-product-cutout",
        "label": "Product Cutout",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "providerOptions",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v1-product-cutout.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/product/cutout",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "image_url": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v1-product-cutout.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v1-product-packshot",
        "label": "Product Packshot",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "providerOptions",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v1-product-packshot.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/product/packshot",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "image_url": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v1-product-packshot.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v1-product-shadow",
        "label": "Product Shadow",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "providerOptions",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v1-product-shadow.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/product/shadow",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "image_url": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v1-product-shadow.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v1-product-lifestyle-shot-by-text",
        "label": "Lifestyle Product Shot by Text",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "scene_description",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v1-product-lifestyle-shot-by-text.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/product/lifestyle_shot_by_text",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "image_url": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                },
                "scene_description": {
                  "$omitEmpty": {
                    "$ref": "request.prompt"
                  }
                },
                "num_results": {
                  "$omitEmpty": {
                    "$ref": "request.imageCount"
                  }
                },
                "aspect_ratio": {
                  "$omitEmpty": {
                    "$ref": "request.aspectRatio"
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v1-product-lifestyle-shot-by-text.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v1-product-lifestyle-shot-by-image",
        "label": "Lifestyle Product Shot by Image",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "providerOptions",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v1-product-lifestyle-shot-by-image.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/product/lifestyle_shot_by_image",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "image_url": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                },
                "num_results": {
                  "$omitEmpty": {
                    "$ref": "request.imageCount"
                  }
                },
                "aspect_ratio": {
                  "$omitEmpty": {
                    "$ref": "request.aspectRatio"
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v1-product-lifestyle-shot-by-image.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-image-edit-product-integrate",
        "label": "Embed products into a scene",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "providerOptions",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-image-edit-product-integrate.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/image/edit/product/integrate",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "scene": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-image-edit-product-integrate.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-image-edit-product-cutout",
        "label": "Product Cutout (v2)",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "providerOptions",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-image-edit-product-cutout.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/image/edit/product/cutout",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "image": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-image-edit-product-cutout.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-image-edit-product-holding",
        "label": "Product Holding",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "instruction",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-image-edit-product-holding.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/image/edit/product/holding",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "person_image": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                },
                "product_images": {
                  "$omitEmpty": {
                    "$map": {
                      "from": {
                        "$filter": {
                          "from": {
                            "$ref": "request.images"
                          },
                          "as": "media",
                          "where": {
                            "$gt": [
                              {
                                "$ref": "mediaIndex"
                              },
                              0
                            ]
                          }
                        }
                      },
                      "as": "media",
                      "in": {
                        "$dataPayload": {
                          "$ref": "media.value"
                        }
                      }
                    }
                  }
                },
                "instruction": {
                  "$omitEmpty": {
                    "$ref": "request.prompt"
                  }
                },
                "aspect_ratio": {
                  "$omitEmpty": {
                    "$ref": "request.aspectRatio"
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-image-edit-product-holding.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-image-edit-product-virtual-tryon",
        "label": "Virtual Try-On",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "instruction",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-image-edit-product-virtual-tryon.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/image/edit/product/virtual-tryon",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "person_image": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                },
                "garment_images": {
                  "$omitEmpty": {
                    "$map": {
                      "from": {
                        "$filter": {
                          "from": {
                            "$ref": "request.images"
                          },
                          "as": "media",
                          "where": {
                            "$gt": [
                              {
                                "$ref": "mediaIndex"
                              },
                              0
                            ]
                          }
                        }
                      },
                      "as": "media",
                      "in": {
                        "$dataPayload": {
                          "$ref": "media.value"
                        }
                      }
                    }
                  }
                },
                "instruction": {
                  "$omitEmpty": {
                    "$ref": "request.prompt"
                  }
                },
                "aspect_ratio": {
                  "$omitEmpty": {
                    "$ref": "request.aspectRatio"
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-image-edit-product-virtual-tryon.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v1-product-vehicle-shot-by-text",
        "label": "Vehicle Shot by text",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "scene_description",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v1-product-vehicle-shot-by-text.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/product/vehicle/shot_by_text",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "image_url": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                },
                "scene_description": {
                  "$omitEmpty": {
                    "$ref": "request.prompt"
                  }
                },
                "num_results": {
                  "$omitEmpty": {
                    "$ref": "request.imageCount"
                  }
                },
                "aspect_ratio": {
                  "$omitEmpty": {
                    "$ref": "request.aspectRatio"
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v1-product-vehicle-shot-by-text.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v1-product-vehicle-segment",
        "label": "Segmentation",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "providerOptions",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v1-product-vehicle-segment.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/product/vehicle/segment",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "image_url": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v1-product-vehicle-segment.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v1-product-vehicle-generate-reflections",
        "label": "Reflections",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "providerOptions",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v1-product-vehicle-generate-reflections.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/product/vehicle/generate_reflections",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "image_url": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v1-product-vehicle-generate-reflections.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v1-product-vehicle-refine-tires",
        "label": "Tires Refinement",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "providerOptions",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v1-product-vehicle-refine-tires.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/product/vehicle/refine_tires",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "image_url": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v1-product-vehicle-refine-tires.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v1-product-vehicle-apply-effect",
        "label": "Apply Effects",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "providerOptions",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v1-product-vehicle-apply-effect.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/product/vehicle/apply_effect",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "image_url": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v1-product-vehicle-apply-effect.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v1-product-vehicle-harmonize",
        "label": "Harmonization",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "providerOptions",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v1-product-vehicle-harmonize.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/product/vehicle/harmonize",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "image_url": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v1-product-vehicle-harmonize.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "images": {
            "$coalesce": [
              {
                "$ref": "response.result.image_url"
              },
              {
                "$ref": "response.result.images"
              },
              {
                "$ref": "response.image_url"
              },
              {
                "$ref": "response.images"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result.masks"
                  },
                  "as": "mask",
                  "in": {
                    "$ref": "mask.image_url"
                  }
                }
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-video-edit-erase",
        "label": "Eraser",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "providerOptions",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-video-edit-erase.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/video/edit/erase",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "video": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.videos.0.value"
                    }
                  }
                },
                "mask": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$first": {
                        "$map": {
                          "from": {
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
                          },
                          "as": "media",
                          "in": {
                            "$ref": "media.value"
                          }
                        }
                      }
                    }
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-video-edit-erase.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "videos": {
            "$coalesce": [
              {
                "$ref": "response.result.video_url"
              },
              {
                "$ref": "response.result.videos"
              },
              {
                "$ref": "response.video_url"
              },
              {
                "$ref": "response.videos"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-video-segment-mask-by-prompt",
        "label": "Generate Mask by Prompt",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "prompt",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": true
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-video-segment-mask-by-prompt.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/video/segment/mask_by_prompt",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "video": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.videos.0.value"
                    }
                  }
                },
                "prompt": {
                  "$omitEmpty": {
                    "$ref": "request.prompt"
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-video-segment-mask-by-prompt.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "videos": {
            "$coalesce": [
              {
                "$ref": "response.result.video_url"
              },
              {
                "$ref": "response.result.videos"
              },
              {
                "$ref": "response.video_url"
              },
              {
                "$ref": "response.videos"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-video-segment-mask-by-key-points",
        "label": "Generate Mask by Key Points",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "providerOptions",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-video-segment-mask-by-key-points.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/video/segment/mask_by_key_points",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "video": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.videos.0.value"
                    }
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-video-segment-mask-by-key-points.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "videos": {
            "$coalesce": [
              {
                "$ref": "response.result.video_url"
              },
              {
                "$ref": "response.result.videos"
              },
              {
                "$ref": "response.video_url"
              },
              {
                "$ref": "response.videos"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-video-generate-foreground-mask",
        "label": "Foreground Mask",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "providerOptions",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-video-generate-foreground-mask.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/video/generate/foreground_mask",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "video": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.videos.0.value"
                    }
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-video-generate-foreground-mask.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "videos": {
            "$coalesce": [
              {
                "$ref": "response.result.video_url"
              },
              {
                "$ref": "response.result.videos"
              },
              {
                "$ref": "response.video_url"
              },
              {
                "$ref": "response.videos"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-video-edit-increase-resolution",
        "label": "Increase Resolution - up to 8K",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": true,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "providerOptions",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-video-edit-increase-resolution.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/video/edit/increase_resolution",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "video": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.videos.0.value"
                    }
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-video-edit-increase-resolution.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "videos": {
            "$coalesce": [
              {
                "$ref": "response.result.video_url"
              },
              {
                "$ref": "response.result.videos"
              },
              {
                "$ref": "response.video_url"
              },
              {
                "$ref": "response.videos"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-video-edit-remove-background",
        "label": "Remove Background",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "providerOptions",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-video-edit-remove-background.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/video/edit/remove_background",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "video": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.videos.0.value"
                    }
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-video-edit-remove-background.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "videos": {
            "$coalesce": [
              {
                "$ref": "response.result.video_url"
              },
              {
                "$ref": "response.result.videos"
              },
              {
                "$ref": "response.video_url"
              },
              {
                "$ref": "response.videos"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-video-edit-replace-background",
        "label": "Replace Background",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": true,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "providerOptions",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-video-edit-replace-background.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/video/edit/replace_background",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "video": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.videos.0.value"
                    }
                  }
                },
                "background_url": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.images.0.value"
                    }
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-video-edit-replace-background.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "videos": {
            "$coalesce": [
              {
                "$ref": "response.result.video_url"
              },
              {
                "$ref": "response.result.videos"
              },
              {
                "$ref": "response.video_url"
              },
              {
                "$ref": "response.videos"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-video-edit-green-screen",
        "label": "Green Screen",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "providerOptions",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-video-edit-green-screen.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/video/edit/green_screen",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "video": {
                  "$omitEmpty": {
                    "$dataPayload": {
                      "$ref": "request.videos.0.value"
                    }
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-video-edit-green-screen.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "videos": {
            "$coalesce": [
              {
                "$ref": "response.result.video_url"
              },
              {
                "$ref": "response.result.videos"
              },
              {
                "$ref": "response.video_url"
              },
              {
                "$ref": "response.videos"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.result.urls"
              },
              {
                "$ref": "response.urls"
              },
              {
                "$map": {
                  "from": {
                    "$ref": "response.result"
                  },
                  "as": "item",
                  "in": {
                    "$first": {
                      "$ref": "item"
                    }
                  }
                }
              },
              {
                "$ref": "response.data"
              }
            ]
          }
        }
      },
      {
        "id": "bria-v2-ads-delayer",
        "label": "Decompose an ad into layers",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "providerOptions",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-ads-delayer.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/ads/delayer",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {},
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-ads-delayer.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "text": {
            "$if": {
              "condition": {
                "$ref": "response.result"
              },
              "then": {
                "$json": {
                  "$ref": "response.result"
                }
              },
              "else": ""
            }
          }
        }
      },
      {
        "id": "bria-v2-ads-resize",
        "label": "Resize an ad into other sizes",
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
        "baseUrl": "https://engine.prod.bria-api.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api_token"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "mapping": "prompt",
            "description": "Prompt or instruction when this Bria endpoint accepts it.",
            "required": false
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "image/images/image_url",
            "description": "Source or reference images."
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "bria-v2-ads-resize.body",
            "description": "Other documented Bria request-body fields"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/ads/resize",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "prompt": {
                  "$omitEmpty": {
                    "$ref": "request.prompt"
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.bria-v2-ads-resize.body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/status/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$ref": "response.request_id"
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
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "text": {
            "$if": {
              "condition": {
                "$ref": "response.result"
              },
              "then": {
                "$json": {
                  "$ref": "response.result"
                }
              },
              "else": ""
            }
          }
        }
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
