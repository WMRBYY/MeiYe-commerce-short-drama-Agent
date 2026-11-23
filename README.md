# Ww-E-commerce short drama Agent

创作、短剧、电商三模式的完整工程源码包，当前仓库保持私有，供维护者测试。

## 包含内容

- 创作：对话、普通图片/视频生成、自由画布、技能、素材、跳舞复刻。
- 短剧：项目、剧本、角色、分镜、制作台、预演与画布联动。
- 电商：生图、换装、图像编辑、详情图、普通视频生成、模板展示、画布和作品管理。
- 后台：用户、渠道、模型、积分、支付、存储、插件、通用电商 Agent 等管理模块。
- 前后端源码、公共静态资源、文档、Docker/Compose、插件源码及打包脚本。

按约定排除：电商视频复刻和电商剧本创作、创作商品视频中的模特/商品替换和爆款策划、后台电商视频 Agent、头像昵称审核。短剧剧本与普通个人资料编辑保留。跳舞复刻使用普通创作视频任务，需要配置支持图片与视频参考的模型。

## 本地运行

前端使用 Bun；后端使用 Go 1.25 和支持 CGO 的 C 编译器。视频处理需要 FFmpeg/ffprobe。模型、支付与存储均需自行配置，示例配置不包含真实凭证。

```sh
cd backend
CANVAS_BACKEND_DATA_DIR=../.local/test-data go run ./cmd/server
```

```sh
cd web
bun install --frozen-lockfile
VITE_API_PROXY_TARGET=http://127.0.0.1:8080 bun run dev
```

首个注册用户为管理员；按需在后台开启功能开关并配置模型渠道。Docker 入口为根目录 `docker-compose.yml`。支付插件的可执行文件通过 `plugin-packages/build-packages.sh` 或 Docker 构建生成，不提供原机器的预编译支付程序。

## 数据与验证

不包含生产数据库、用户上传、原项目 Git 历史或真实环境变量。自定义服务地址已替换为占位符，运行前需要填写自己的配置。第三方资源保留各自许可；示例用户作品和模特库不附带个人数据。

具体检查结果见 [VALIDATION](docs/VALIDATION.md)。构建与页面检查不等于真实模型生成、支付或所有业务场景均已验收。

## 许可

代码遵循根目录 LICENSE 与 NOTICE；第三方组件、字体和素材遵循其各自许可证。