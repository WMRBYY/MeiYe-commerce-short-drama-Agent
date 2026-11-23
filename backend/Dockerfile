# syntax=docker/dockerfile:1.7

FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS payment-package-build

ARG GOPROXY=https://goproxy.cn,direct
ENV GOPROXY=$GOPROXY

RUN printf 'https://mirrors.tencent.com/alpine/v3.22/main\nhttps://mirrors.tencent.com/alpine/v3.22/community\n' > /tmp/alpine-repositories \
    && apk --timeout 30 --repositories-file /tmp/alpine-repositories add --no-cache nodejs unzip zip \
    && rm /tmp/alpine-repositories

WORKDIR /src
# 插件只下载实际依赖，不为四个小程序预取整个业务后端的模块图。
COPY backend ./backend
COPY plugin-packages ./plugin-packages
ARG TARGETOS
ARG TARGETARCH
RUN --mount=type=cache,target=/root/.cache/go-build set -eu; \
    test -n "$TARGETOS"; \
    test -n "$TARGETARCH"; \
    PAYMENT_PLUGIN_GOOS="$TARGETOS" \
    PAYMENT_PLUGIN_GOARCH="$TARGETARCH" \
    PAYMENT_PLUGIN_CGO_ENABLED=0 \
      ./plugin-packages/build-packages.sh; \
    sh ./plugin-packages/verify-payment-packages.sh "$TARGETOS" "$TARGETARCH"; \
    test -f ./plugin-packages/openai-images.yingce-plugin; \
    test -f ./plugin-packages/openai-chat-completions.yingce-plugin; \
    test -f ./plugin-packages/openai-videos.yingce-plugin

FROM alpine:3.22 AS payment-package-smoke

ARG TARGETOS
ARG TARGETARCH
RUN printf 'https://mirrors.tencent.com/alpine/v3.22/main\nhttps://mirrors.tencent.com/alpine/v3.22/community\n' > /tmp/alpine-repositories \
    && apk --timeout 30 --repositories-file /tmp/alpine-repositories add --no-cache unzip \
    && rm /tmp/alpine-repositories
COPY --from=payment-package-build /src/plugin-packages /app/plugin-packages
RUN PAYMENT_PLUGIN_SMOKE_TEST=1 \
    sh /app/plugin-packages/verify-payment-packages.sh "$TARGETOS" "$TARGETARCH"

FROM golang:1.25-alpine AS backend-build

ARG GOPROXY=https://goproxy.cn,direct
ENV GOPROXY=$GOPROXY

RUN printf 'https://mirrors.tencent.com/alpine/v3.22/main\nhttps://mirrors.tencent.com/alpine/v3.22/community\n' > /tmp/alpine-repositories \
    && apk --timeout 30 --repositories-file /tmp/alpine-repositories add --no-cache build-base \
    && rm /tmp/alpine-repositories

WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
# go.mod 含本地 replace（github.com/casdoor/go-sms-sender => ./third_party/go-sms-sender）。
# go mod download 解析依赖时就需要读到该目录的 go.mod，而这行执行时完整源码尚未复制，
# 缺了它会报 "reading third_party/go-sms-sender/go.mod: no such file or directory"。
# 后面 COPY backend ./ 会覆盖为完整源码，这里只为让依赖解析通过。
COPY backend/third_party ./third_party
# 模块保留在普通镜像层中，供后续编译及跨 Runner 的 GHA 层缓存复用。
RUN go mod download
COPY backend ./
COPY VERSION /src/VERSION
ARG BUILD_VERSION
ARG BUILD_COMMIT=unknown
ARG BUILD_TIME=unknown
RUN --mount=type=cache,target=/root/.cache/go-build set -eu; \
    version="${BUILD_VERSION:-$(tr -d '\r\n' </src/VERSION)}"; \
    ldflags="-s -w -X yingce/backend/internal/buildinfo.Version=${version} -X yingce/backend/internal/buildinfo.Commit=${BUILD_COMMIT} -X yingce/backend/internal/buildinfo.BuildTime=${BUILD_TIME}"; \
    CGO_ENABLED=1 GOOS=linux go build -trimpath -ldflags="$ldflags" -o /out/yingce-backend ./cmd/server; \
    CGO_ENABLED=1 GOOS=linux go build -trimpath -ldflags="$ldflags" -o /out/migrate-schema ./cmd/migrate-schema; \
    CGO_ENABLED=1 GOOS=linux go build -trimpath -ldflags="$ldflags" -o /out/migrate-sqlite-postgres ./cmd/migrate-sqlite-postgres

FROM node:22.19-alpine AS pi-runtime-deps

WORKDIR /app/backend/agent-runtime/pi
COPY backend/agent-runtime/pi/package.json backend/agent-runtime/pi/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:22.19-alpine

# ffmpeg/ffprobe：短剧抽取剧情段视频最后一帧、时间线合成成片、视频播放转码，以及参考视频链接解析的音视频合并与校验。
# chromium：参考视频链接解析打开抖音官方嵌入播放器（无头模式、调试管道、不监听端口）；tini 作为 1 号进程回收浏览器子进程。
RUN printf 'https://mirrors.tencent.com/alpine/v3.22/main\nhttps://mirrors.tencent.com/alpine/v3.22/community\n' > /tmp/alpine-repositories \
    && apk --timeout 30 --repositories-file /tmp/alpine-repositories add --no-cache ca-certificates tzdata wget ffmpeg chromium tini fontconfig font-noto-cjk font-noto-cjk-extra tesseract-ocr tesseract-ocr-data-chi_sim tesseract-ocr-data-eng \
    && rm /tmp/alpine-repositories \
    && find /usr/share/fonts/noto -name "Noto*CJK-*.ttc" ! -name "*-Regular.ttc" ! -name "*-Bold.ttc" ! -name "*-Black.ttc" ! -name "*-Light.ttc" -delete \
    && chromium --version \
    && tesseract --list-langs \
    && addgroup -S app \
    && adduser -S app -G app

# 可选：python3 + yt-dlp，供默认未开放的哔哩哔哩、微博及海外平台使用（CANVAS_VIDEO_PARSER_PLATFORMS 开启后才会调用）。
# 只装 PyPI 基础包（Unlicense），不装 mutagen 等 GPL 可选依赖；版本与 wheel 哈希固定，升级时同时更新两处。
ARG INSTALL_YTDLP=false
ARG YTDLP_VERSION=2026.10.26
ARG YTDLP_SHA256=a05c5b5d8562f7e8a62f5334348b406af4930d56d3a65f8021d14af0e22339ae
ARG PIP_INDEX_URL=https://pypi.org/simple
RUN if [ "$INSTALL_YTDLP" = "true" ]; then \
      printf 'https://mirrors.tencent.com/alpine/v3.22/main\nhttps://mirrors.tencent.com/alpine/v3.22/community\n' > /tmp/alpine-repositories \
      && apk --timeout 30 --repositories-file /tmp/alpine-repositories add --no-cache python3 \
      && rm /tmp/alpine-repositories \
      && python3 -m venv /opt/yt-dlp \
      && printf 'yt-dlp==%s --hash=sha256:%s\n' "$YTDLP_VERSION" "$YTDLP_SHA256" > /tmp/yt-dlp-requirements.txt \
      && /opt/yt-dlp/bin/pip install --no-cache-dir --no-deps --require-hashes --index-url "$PIP_INDEX_URL" -r /tmp/yt-dlp-requirements.txt \
      && rm /tmp/yt-dlp-requirements.txt \
      && ln -s /opt/yt-dlp/bin/yt-dlp /usr/local/bin/yt-dlp \
      && yt-dlp --version; \
    fi

WORKDIR /app
ENV GIN_MODE=release
ENV CANVAS_BACKEND_ADDR=:8080
ENV CANVAS_BACKEND_DATA_DIR=/data

RUN mkdir -p /data && chown -R app:app /data
COPY --from=backend-build /out/yingce-backend /usr/local/bin/yingce-backend
COPY --from=backend-build /out/migrate-schema /usr/local/bin/migrate-schema
COPY --from=backend-build /out/migrate-sqlite-postgres /usr/local/bin/migrate-sqlite-postgres
COPY --from=payment-package-smoke /app/plugin-packages /app/plugin-packages
COPY --from=pi-runtime-deps /app/backend/agent-runtime/pi/node_modules /app/backend/agent-runtime/pi/node_modules
COPY backend/agent-runtime/pi/package.json backend/agent-runtime/pi/package-lock.json /app/backend/agent-runtime/pi/
COPY backend/agent-runtime/pi/agent-runtime.mjs /app/backend/agent-runtime/pi/agent-runtime.mjs

USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:8080/api/health/ready >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["yingce-backend"]
