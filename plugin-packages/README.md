# 模型与支付插件

各插件的 `manifest.json` 描述能力与入口。先阅读对应目录的 README，再选择与自己的服务匹配的协议。复制插件包不会复制商户、账户或渠道配置。

在具备 sh、zip 和 Go 工具链的环境中，从仓库根目录执行 `sh plugin-packages/build-packages.sh` 可重新打包。支付插件需要目标平台对应的可执行文件；详见[构建脚本](build-packages.sh)。
