const ref = (path) => ({ $ref: path });
const eq = (a, b) => ({ $eq: [a, b] });
const len = (a) => ({ $len: a });
const and = (...args) => ({ $and: args });
const iff = (condition, then, otherwise = null) => ({ $if: { condition, then, else: otherwise } });
const coalesce = (...values) => ({ $coalesce: values });
const first = (value) => ({ $first: value });
const filter = (from, as, where) => ({ $filter: { from, as, where } });
const map = (from, as, body) => ({ $map: { from, as, in: body } });
const images = { $sortByOrder: ref("request.images") };
const hasImages = { $gt: [len(images), 0] };
const taskField = (name) => first(map(filter(ref("response.data"), "task", eq(ref("task.id"), ref("taskId"))), "task", ref(`task.${name}`)));
const outputs = taskField("outputs");
const videoURLs = map(filter(outputs, "output", eq(ref("output.type"), "video")), "output", ref("output.url"));
const status = coalesce(ref("response.data.status"), taskField("status"));
const businessFailed = { $ne: [ref("response.code"), 0] };
const missingVideo = and(eq(status, "succeeded"), eq(len(videoURLs), 0));

export const klingOfficialSpec = {
  id: "kling-official", providerId: "kling-official", name: "可灵官方", vendor: "Kuaishou", capability: "video",
  baseUrl: "https://api-beijing.klingai.com", auth: { type: "bearer", field: "apiKey" }, requiresPublicMediaUrls: true,
  params: [
    ["model", "string", true, "endpoint", "当前支持 kling-3.0。"],
    ["prompt", "string", true, "prompt/contents", "视频提示词，最多 3072 字符。"],
    ["images", "media[]", false, "contents", "首帧与可选尾帧；不支持角色参考图片。"],
    ["duration", "integer", true, "settings.duration", "3–15 秒整数。"],
    ["aspectRatio", "string", false, "settings.aspect_ratio", "16:9、9:16、1:1。图生视频由图片决定。"],
    ["resolution", "string", false, "settings.resolution", "720p、1080p、4k。"],
    ["generateAudio", "boolean", false, "settings.audio", "原生音频开关。"],
  ],
  notes: "对接官方新版单 API Key，旧 AK/SK 不能直接填入。创建和查询使用同一区域；GET /tasks 按原任务 ID 查询，不重新提交。响应中临时视频 URL 交由宿主下载保存。官方文档：https://kling.ai/document-api/apiReference/model/textToVideo 与 imageToVideo。",
  validations: [
    { assert: eq(ref("request.model"), "kling-3.0"), message: "可灵官方当前支持模型 kling-3.0" },
    { assert: and({ $gte: [ref("request.duration"), 3] }, { $lte: [ref("request.duration"), 15] }), message: "可灵视频时长须为 3–15 秒" },
    { assert: { $lte: [len(ref("request.prompt")), 3072] }, message: "可灵提示词最多 3072 字符" },
    { assert: and(eq(len(ref("request.videos")), 0), eq(len(ref("request.audios")), 0), { $lte: [len(images), 2] }), message: "当前可灵协议支持文字或首尾帧图片，不支持参考视频和音频" },
    { assert: eq(len(filter(images, "image", { $not: { $in: [ref("image.role"), ["first_frame", "last_frame"]] } })), 0), message: "可灵图片须指定首帧或尾帧" },
    { assert: iff(hasImages, and(eq(len(filter(images, "image", eq(ref("image.role"), "first_frame"))), 1), { $lte: [len(filter(images, "image", eq(ref("image.role"), "last_frame"))), 1] }), true), message: "图生视频需要一张首帧，最多一张尾帧" },
    { assert: { $in: [{ $lower: ref("request.resolution") }, ["720p", "1080p", "4k"]] }, message: "可灵分辨率须为 720p、1080p 或 4k" },
  ],
  create: {
    method: "POST", path: "/text-to-video/kling-3.0", contentType: "application/json",
    pathTemplate: iff(hasImages, "/image-to-video/kling-3.0", "/text-to-video/kling-3.0"),
    body: { $merge: [
      iff(hasImages, { contents: { $concatArrays: [[{ type: "prompt", text: ref("request.prompt") }], map(images, "image", { type: ref("image.role"), url: ref("image.value") })] } }, { prompt: ref("request.prompt") }),
      { settings: {
        duration: ref("request.duration"), resolution: { $lower: ref("request.resolution") },
        aspect_ratio: { $omitEmpty: iff(hasImages, null, coalesce(ref("request.aspectRatio"), "16:9")) },
        audio: iff(ref("request.generateAudio"), "native", "off"), multi_shot: false,
      } },
    ] },
  },
  poll: { method: "GET", path: "/tasks", query: { task_ids: ref("taskId") } },
  response: {
    taskId: coalesce(ref("response.data.id"), ref("taskId")),
    status: iff(businessFailed, "failed", iff(missingVideo, "failed", coalesce(status, "pending"))),
    message: iff(businessFailed, coalesce(ref("response.message"), "可灵请求失败"), iff(missingVideo, "可灵任务已结束，但未返回视频文件", taskField("message"))),
    videos: videoURLs, resultEphemeral: true,
  },
};
