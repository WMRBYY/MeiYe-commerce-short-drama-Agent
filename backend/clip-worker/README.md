# 电商人物遮罩 Worker

此目录只实现「字在人后」的人物视频遮罩。Go 后端读取已鉴权的资源，统一为原比例、30 fps 的视频，再通过 CLI 调用 SAM 2.1。完成后由 FFmpeg 将原画面、文字、人物遮罩合成；不调用视频生成模型。

## 部署

建议独立 Linux GPU 执行环境，Python 3.11、与 PyTorch 2.5.1 匹配的 CUDA 驱动、FFmpeg / ffprobe，以及至少可容纳 120 帧 SAM 输入的 CPU 内存。Worker 使用进程间文件锁默认串行执行 GPU 推理；多容器共享同一 GPU 时，必须将 `CANVAS_SHOP_CLIP_GPU_LOCK` 指向共享挂载中的同一可写文件。不同 GPU 可指定不同锁文件，并通过 `CUDA_VISIBLE_DEVICES` 选卡。本目录不自动下载模型。

```bash
python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

管理员从 [SAM 2 官方检查点](https://github.com/facebookresearch/sam2#download-checkpoints)取得 `sam2.1_hiera_small.pt`，与 `configs/sam2.1/sam2.1_hiera_s.yaml` 配套保存。代码固定到官方提交，权重需在部署清单中记录 SHA256。SAM 2 的模型与代码为 Apache 2.0，仓库包含的其他第三方许可仍需随分发保留。

在**执行剪辑任务的后端进程**配置：

```bash
CANVAS_SHOP_CLIP_PYTHON=/opt/clip-worker/.venv/bin/python
CANVAS_SHOP_CLIP_MASK_SCRIPT=/opt/clip-worker/sam2_mask.py
CANVAS_SHOP_CLIP_SAM2_CHECKPOINT=/models/sam2.1_hiera_small.pt
CANVAS_SHOP_CLIP_SAM2_CONFIG=configs/sam2.1/sam2.1_hiera_s.yaml
CANVAS_SHOP_CLIP_GPU_LOCK=/shared/locks/sam2-gpu0.lock
CANVAS_FFMPEG_PATH=/usr/bin/ffmpeg
```

`ffprobe` 必须在 PATH。先运行下面的真实依赖探测；缺少脚本、权重、CUDA、Python 模块或配置时，前端能力接口返回不可用并阻止生成，不会把空遮罩当成功。

```bash
.venv/bin/python sam2_mask.py --check --checkpoint /models/sam2.1_hiera_small.pt
```

`--check` 验证文件、权重可读性、配置、导入和 CUDA 可见性，不替代 GPU 模型实例化与样片推理。正式开放前必须实际运行：

```bash
.venv/bin/python sam2_mask.py --checkpoint /models/sam2.1_hiera_small.pt \
  --input normalized.mp4 --output foreground.mkv --box '[0.2,0.05,0.6,0.9]'
```

输入必须已统一 30 fps、方形像素，box 为首帧中用户选择人物的 `[x,y,width,height]` 归一化坐标。仅使用当前用户明确选中的主体；不会将中心框称为自动人物识别。输出为同尺寸、同帧数、无音轨的 FFV1 灰度 MKV（白色为人物，黑色为背景）。

## 资源与质量边界

- 最长 5 分钟。每次保留 120 帧推理状态，前后块重叠 1 帧，将前一块末帧遮罩传入下一块以限制内存；临时 JPEG、模型状态、遮罩由任务结束/取消清理。
- Go 取消任务时终止 Python 及其 FFmpeg 子进程树，避免后台编码残留。
- 等待 GPU 锁最多 20 分钟；取消/进程被终止后，操作系统自动释放锁，不需要清除文件来“解锁”。
- 推荐连续单人镜头。SAM 2 输出分割遮罩，不是细发丝 alpha；大幅遮挡、切镜、多人交叉会影响质量，不能承诺无瑕疵抠像。
- 上线验收需覆盖首尾帧、转头、手遮脸、人物离开画面、块边界、横竖视频和取消。合成遮罩的 FFmpeg 测试只证明分层合成正确，不证明 SAM 人物质量。
- 中文字幕采用项目已有真实句级时间戳；本 worker 不提供逐字识别或强制对齐。
