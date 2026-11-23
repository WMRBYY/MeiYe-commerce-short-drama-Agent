# Web 容器

根目录的 [Dockerfile](../Dockerfile) 构建前端，[nginx.conf](../nginx.conf) 提供静态文件并转发 API 请求。[容器入口脚本](canvas-web-entrypoint.sh) 将资源写入 Web 卷，再切换首页，使新打开的页面可以找到对应的脚本。

本地从源码构建请使用[默认 Compose 文件](../docker-compose.yml)。
