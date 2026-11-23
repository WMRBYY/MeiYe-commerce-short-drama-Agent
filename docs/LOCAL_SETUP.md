# 在本机运行梅野

前端使用 Bun，后端使用 Go 1.25 与支持 CGO 的 C 编译器。处理视频还需安装 FFmpeg，并保证 `ffmpeg` 与 `ffprobe` 在 PATH 中。以下命令从仓库根目录开始，在两个终端分别执行。

## 后端

```sh
cd backend
CANVAS_BACKEND_ADDR=127.0.0.1:8080 CANVAS_BACKEND_DATA_DIR=../.local/test-data go run ./cmd/server
```

PowerShell 中使用：

```powershell
cd backend
$env:CANVAS_BACKEND_ADDR = "127.0.0.1:8080"
$env:CANVAS_BACKEND_DATA_DIR = "../.local/test-data"
go run ./cmd/server
```

## 前端

```sh
cd web
bun install --frozen-lockfile
bun run dev --host 127.0.0.1
```

打开终端打印的本地地址（默认 3000 端口）。开发服务器默认将 API 请求转发到本机 8080 端口。首次注册得到管理员账号；在后台开启目标模式，并在模型与渠道页面配置自己的服务。数据保存在上面指定的本地目录，再次启动请使用同一目录。

## Docker

若只想体验界面，可按[首页的 Docker 命令](../README.md#本地启动)从当前源码构建。查看状态用 `docker compose ps`，看启动记录用 `docker compose logs backend web`，结束体验用 `docker compose down`。默认 Compose 发布主机的 3000 端口；首次注册前请使用可信网络。
