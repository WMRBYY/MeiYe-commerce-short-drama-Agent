import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { MANAGED_MEDIA_NODES, type ManagedMediaNodeId } from "@/lib/media-conversion/managed-nodes";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type Position } from "@/types/canvas";

type Preset = {
    heading: string;
    lead: string;
    steps: [string, string, string];
    sourceTitle: string;
    outputTitle: string;
};

const PRESETS: Record<ManagedMediaNodeId, Preset> = {
    "image-remove-background": {
        heading: "一键去白底，保留透明主体",
        lead: "商品图、人物或物件需要干净抠图？上传一张图片，即可得到透明 PNG。",
        steps: ["在左侧图片节点上传要处理的原图；示例图可直接试用。", "确认左侧连线接入右侧「图片移除背景」功能节点。", "点击「开始转换」，生成后可预览并下载透明 PNG。"],
        sourceTitle: "原图 · 可替换",
        outputTitle: "透明主体 · 图片移除背景",
    },
    "image-upscale": {
        heading: "低清图片，一步放大细节",
        lead: "放大尺寸的同时改善边缘和纹理，适合老图、素材图与商品细节图。",
        steps: ["在左侧图片节点上传需要放大的原图；示例图可直接试用。", "在右侧选择 2 倍或 4 倍分辨率。", "点击「开始转换」，等待真实超分任务完成后下载图片。"],
        sourceTitle: "原图 · 可替换",
        outputTitle: "高清图片 · 图片分辨率提高",
    },
    "psd-layers": {
        heading: "主体与背景，拆成可编辑图层",
        lead: "自动分离主体并修补背景，导出由两层组成的 PSD，方便继续精修。",
        steps: ["在左侧图片节点上传需要拆层的原图；示例图可直接试用。", "保持左侧图片与右侧「PSD 分层」功能节点的连线。", "点击「开始转换」，分别生成主体与背景后下载 PSD。"],
        sourceTitle: "原图 · 可替换",
        outputTitle: "可编辑图层 · PSD 分层",
    },
    "video-replace-background": {
        heading: "保留人物动作，换一个视频背景",
        lead: "准备一段 60 秒以内的视频和一张新背景图，生成替换场景后的短片。",
        steps: ["在左侧上方上传原视频，在下方上传目标背景图片。", "保留两条输入连线，右侧节点会同时读取视频与背景。", "点击「开始转换」，等待真实任务完成后预览和下载视频。"],
        sourceTitle: "原视频 · 可替换",
        outputTitle: "新场景视频 · 视频替换背景",
    },
    "video-upscale": {
        heading: "低清视频，提升画面细节",
        lead: "适合先快速产出草片，再将 60 秒以内的片段做高清处理。",
        steps: ["在左侧视频节点上传需要提清的短片；示例短片可直接试用。", "在右侧选择 2 倍或 4 倍分辨率。", "点击「开始转换」，任务完成后预览并下载高清视频。"],
        sourceTitle: "原视频 · 可替换",
        outputTitle: "高清视频 · 视频分辨率提升",
    },
    "image-expand": {
        heading: "扩展画幅，让画面自然长出来",
        lead: "把局促构图扩成适合横版、竖版或方形的画幅，并补全画面外的内容。",
        steps: ["在左侧图片节点上传原图；示例图可直接试用。", "在右侧选择目标画幅，按需要填写扩张区域的英文提示词。", "点击「开始转换」，生成后可预览并下载扩张后的图片。"],
        sourceTitle: "原图 · 可替换",
        outputTitle: "扩张画面 · 图像扩张",
    },
};

function instructionDocument(preset: Preset) {
    const paragraph = (value: string) => ({ type: "paragraph", content: [{ type: "text", text: value }] });
    return { type: "doc", content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: preset.heading }] },
        { type: "paragraph", content: [
            { type: "text", text: "一句话读懂功能： " },
            { type: "text", text: preset.lead, marks: [{ type: "bold" }] },
        ] },
        ...preset.steps.map((step, index) => paragraph(`${index + 1}. ${step}`)),
    ] };
}

export function buildCanvasMediaToolboxPreset(id: ManagedMediaNodeId, center: Position): { nodes: CanvasNodeData[]; connections: CanvasConnection[]; frameId: string } {
    const tool = MANAGED_MEDIA_NODES.find((item) => item.id === id)!;
    const copy = PRESETS[id];
    const replacingBackground = id === "video-replace-background";
    const width = 1320;
    const height = replacingBackground ? 1120 : 990;
    const left = center.x - width / 2;
    const top = center.y - height / 2;
    const frame = createCanvasNode(CanvasNodeType.Frame, center, {
        frame: { collapsed: false, expandedWidth: width, expandedHeight: height },
        toolboxPresetId: id,
        toolboxRole: "group",
    });
    frame.title = tool.label;
    frame.position = { x: left, y: top };
    frame.width = width;
    frame.height = height;

    const inputType = tool.inputKind === "video" ? CanvasNodeType.Video : CanvasNodeType.Image;
    const sourcePath = tool.inputKind === "video" ? `/toolbox/${id}-source.webm` : `/toolbox/${id}-source.png`;
    const source = createCanvasNode(inputType, { x: 0, y: 0 }, {
        toolboxPresetId: id,
        toolboxRole: "source",
        content: sourcePath,
        previewContent: tool.inputKind === "video" ? `/toolbox/${id}-source.webp` : sourcePath,
        mimeType: tool.inputKind === "video" ? "video/webm" : "image/png",
        ...(tool.inputKind === "video" ? { durationMs: 3000 } : {}),
    });
    source.title = copy.sourceTitle;
    source.parentId = frame.id;
    source.position = { x: left + 44, y: top + 96 };
    source.width = 576;
    source.height = replacingBackground ? 278 : 458;

    const output = createCanvasNode(CanvasNodeType.MediaConversion, { x: 0, y: 0 }, {
        canvasNodeId: id,
        toolboxPresetId: id,
        toolboxRole: "function",
        mediaConversion: { schemaVersion: 1, operation: id, status: "idle" },
    });
    output.title = copy.outputTitle;
    output.parentId = frame.id;
    output.position = { x: left + 700, y: top + 96 };
    output.width = 576;
    output.height = replacingBackground ? 586 : 458;

    const notes = createCanvasNode(CanvasNodeType.Text, { x: 0, y: 0 }, {
        toolboxPresetId: id,
        toolboxRole: "instruction",
        content: [copy.heading, `一句话读懂功能： ${copy.lead}`, ...copy.steps].join("\n"),
        richText: instructionDocument(copy),
        fontSize: 10,
    });
    notes.title = "使用说明";
    notes.parentId = frame.id;
    notes.position = { x: left + 44, y: top + (replacingBackground ? 722 : 594) };
    notes.width = width - 88;
    notes.height = 324;

    const nodes = [frame, source, output, notes];
    const connections: CanvasConnection[] = [{ id: `toolbox-${source.id}-${output.id}`, fromNodeId: source.id, toNodeId: output.id }];
    if (replacingBackground) {
        const background = createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, {
            toolboxPresetId: id,
            toolboxRole: "source",
            content: "/toolbox/video-replace-background-scene.png",
            previewContent: "/toolbox/video-replace-background-scene.png",
            mimeType: "image/png",
        });
        background.title = "新背景 · 可替换";
        background.parentId = frame.id;
        background.position = { x: left + 44, y: top + 404 };
        background.width = 576;
        background.height = 278;
        nodes.push(background);
        connections.push({ id: `toolbox-${background.id}-${output.id}`, fromNodeId: background.id, toNodeId: output.id });
    }
    return { nodes, connections, frameId: frame.id };
}
