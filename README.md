<h1 align="center">Ww · 影策工作台</h1>
<p align="center"><strong>写下一个故事，拍成一部短剧；拍下一件商品，做出一组商品图。</strong></p>
<p align="center"><a href="#电商工作台">电商工作台</a> · <a href="#短剧模式">短剧模式</a> · <a href="#本地启动">本地启动</a> · <a href="docs/index.md">开发文档</a> · <a href="SECURITY.md">安全策略</a> · <a href="#许可证">许可证</a></p>

影策把创作、短剧和电商放在同一个工作台。写短剧时，可以按集整理原文，把台词、动作和运镜拆成分镜；做商品图时，从一张参考图开始换背景、试穿或编排详情页。需要比较几个方向时，就在自由画布上把文字和画面放在一起。

![短剧制作台：左侧按集选章，右侧查看《末班车的来信》第一集的三段六镜](docs/images/studio.webp)

<p align="center"><em>《末班车的来信》 · 本地示例项目，三章原文，首集六个手写分镜，尚未生成视频。</em></p>

## 产品一览

### 电商工作台

从生成记录里找回商品图，或进入详情图工作台，把同一件商品的卖点排成一组图。视频模板按品类和时长浏览；在电商画布上，可以把素材与编辑步骤连起来。

| 商品生图 · 生成记录 | 视频模板 · 按品类选创意 |
| --- | --- |
| ![电商：按换背景、重绘等类型筛选图片，重新打开编辑](docs/images/shop/generation-history.webp) | ![电商：预览护肤、开箱、穿搭和咖啡等视频模板](docs/images/shop/video-templates.webp) |

| 商品详情图 · 从参考图到整页 | 电商画布 · 素材与编辑节点 |
| --- | --- |
| ![电商：左侧设置商品图、参考图与投放平台，右侧查看系列详情图](docs/images/shop/product-details.webp) | ![电商：厨师素材连接到换脸与姿势参考节点](docs/images/shop/workflow-canvas.webp) |

### 短剧模式

从故事灵感或小说原文建立项目，在画布上整理角色，用 3D 预演台安排场景和机位。制作过程中，也可以打开共用的对照台、技能库、素材库和创作历史。

| 故事入口 · 写下短剧想法 | 项目列表 · 找到正在制作的作品 |
| --- | --- |
| ![短剧：首页选择题材、风格、画幅和时长](docs/images/drama/story-brief.webp) | ![短剧：从项目列表查看作品进度、粘贴正文或上传小说](docs/images/drama/projects.webp) |

| 角色画布 · 查看角色设定 | 3D 预演台 · 安排场景与机位 |
| --- | --- |
| ![短剧：角色卡与右侧画布助手](docs/images/drama/character-canvas.webp) | ![短剧：在古城街景中调整建筑、人物和主摄影机](docs/images/drama/previsualization.webp) |

| 图片对照台 · 检查参考画面 | 技能库 · 查找导演与分镜技能 |
| --- | --- |
| ![共用对照台：放大参考图，查看原图或继续编辑](docs/images/drama/image-comparison.webp) | ![短剧：在技能广场浏览导演分镜、角色设计和剧本撰写等技能](docs/images/drama/skill-library.webp) |

| 素材库 · 按类型整理资产 | 创作历史 · 回看生成任务 |
| --- | --- |
| ![短剧：按角色、场景、道具等类别查看素材](docs/images/drama/asset-library.webp) | ![短剧：按画布、类型、模型和任务状态筛选创作记录](docs/images/drama/task-history.webp) |

### 创作与管理

| 创作工作台 · 生成与自由画布 | 运行后台 · 任务与请求 |
| --- | --- |
| ![创作：首页的生成输入框、技能与画布入口](docs/images/create.webp) | ![后台：任务队列、请求趋势与运行状态](docs/images/admin.webp) |
| 从提示词开始生成图片或视频，也可以带着素材进入自由画布。跳舞复刻使用一张角色图和一段参考舞蹈视频。 | 管理员在这里配置模型渠道、用户、积分、支付与存储，查看任务排队和请求记录。 |

## 本地启动

安装 Git、Docker 和 Docker Compose；在有仓库读取权限的终端执行：

```sh
git clone https://github.com/WMRBYY/Ww-E-commerce-short-drama-Agent.git
cd Ww-E-commerce-short-drama-Agent
docker compose up -d --build
```

浏览器打开 [localhost:3000](http://localhost:3000)，在本机完成首个管理员注册。在后台开启需要的工作模式，再添加自己的模型渠道并选择模型。跳舞复刻要选支持图片和视频参考的模型；要启用收款或对象存储，请另行配置自己的商户和存储服务。只浏览界面不需要提交生成任务。

想直接修改源码？参见[本地开发指南](docs/LOCAL_SETUP.md)。构建、页面检查和第三方接入的验证情况记录在[验证记录](docs/VALIDATION.md)。

## 代码从哪里读

| 目录 | 入口 |
| --- | --- |
| [web](web/README.md) | 三种工作模式、画布与管理界面 |
| [backend](backend/README.md) | 账号、项目、任务与数据存储 |
| [yingce-agent](yingce-agent/README.md) | 独立的 Agent 会话运行时 |
| [plugin-packages](plugin-packages/README.md) | 模型协议、支付插件与打包方式 |
| [docker](docker/README.md) · [scripts](scripts/README.md) · [tools](tools/README.md) | 容器、开发校验与维护工具 |

## 许可证

本项目采用 [MIT 协议](LICENSE)。项目特定代码的版权归 ddcat 和 Open AI Canvas 贡献者所有；第三方组件按各自附带的许可证和版权声明使用。相关署名与声明见 [NOTICE](NOTICE)。
