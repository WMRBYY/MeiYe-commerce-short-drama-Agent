import type { CanvasLayer } from "@/pages/ecommerce/result-canvas";
import type { ShopWorkflow } from "./shop-canvas-workflows";

const truth = "保持参考商品的版型、材质、颜色、印花、标识与细节真实一致，不添加不存在的配件或文字。";
const upload = (id: string, text: string, row: number): CanvasLayer => ({
    id,
    type: "draft",
    draftKind: "upload-card",
    text,
    x: 80,
    y: 100 + row * 360,
    materialCategory: id === "model" || id === "person" ? "model_image" : id === "scene" ? "background_image" : "product_image",
});
const step = (id: string, text: string, prompt: string, inputs: string[], row = 0, column = 1, kind = "chat"): CanvasLayer => ({
    id,
    type: "draft",
    draftKind: kind,
    videoKind: kind === "video-replace" ? "model" : undefined,
    text,
    prompt: prompt + truth,
    inputs,
    x: 80 + column * 420,
    y: 100 + row * 360,
    groupId: "outputs",
});
const cover = (id: string) => `/commerce-workflows/${id}.webp`;
const workflow = (id: string, name: string, category: ShopWorkflow["category"], image: string, requirements: string[], description: string, nodes: CanvasLayer[], limitation?: string): ShopWorkflow => ({
    id,
    name,
    category,
    cover: cover(image),
    requirements,
    description,
    nodes,
    limitation,
});
const product = () => upload("product", "上传商品图片", 0);
const model = () => upload("model", "上传模特全身照", 1);
const scene = () => upload("scene", "上传场景参考", 2);
const reference = () => upload("reference", "上传参考视频", 2);

export const COMMERCE_WORKFLOW_LIBRARY: ShopWorkflow[] = [
    workflow("ootd", "复刻 OOTD 展示视频", "视频", "ef6e5cf7723e4e32", ["服装、模特、场景", "参考视频"], "融合整套穿搭，再用参考视频复刻展示动作", [
        product(),
        model(),
        scene(),
        upload("accessory", "上传鞋包配饰（可选）", 3),
        upload("reference", "上传参考视频", 4),
        step("fusion", "穿搭融合图", "将模特穿上参考服装与鞋包，置于参考场景，全身构图，自然光线。", ["product", "model", "scene", "accessory"], 1),
        step("video", "模特 / 商品替换", "保持穿搭与参考视频的动作节奏。", ["fusion", "reference"], 1, 2, "video-replace"),
    ]),
    workflow("garment-scene", "服装产品一键拍摄场景图", "服饰", "20e3784b4540df83", ["商品正面图", "场景参考"], "同一产品分支生成三种场景陈列图", [
        product(),
        scene(),
        ...["悬挂陈列，保留衣服完整轮廓", "自然木质展台，柔和侧光", "极简室内陈列，留出适量负空间"].map((p, i) => step(`scene-${i}`, ["悬挂场景图", "展台场景图", "室内场景图"][i], `参考场景的光线与材质，拍摄商品：${p}。`, ["product", "scene"], i)),
    ]),
    workflow("reference-variants", "参考图生图与分裂新图", "服饰", "2bfc4aa07484a752", ["人物与服装参考"], "保持人物与服装一致，生成不同构图", [
        product(),
        model(),
        ...["全身正面", "半身侧面", "坐姿", "行走抓拍"].map((p, i) => step(`variant-${i}`, p, `使用同一人物与服装，创作${p}时尚摄影，面容一致。`, ["product", "model"], i)),
    ]),
    workflow("details", "细节图工作流", "商品", "d419107bcdd0268a", ["商品整体图", "真实细节图（可选）"], "六个独立细节分支，分别编辑与生成", [
        product(),
        upload("detail", "上传细节参考（可选）", 1),
        ...["材质纹理", "缝线工艺", "纽扣五金", "领口结构", "袖口细节", "整体版型"].map((p, i) => step(`detail-${i}`, p, `为参考商品拍摄${p}展示图。仅表现原图清晰可见的真实细节；没有的结构不要虚构。`, ["product", "detail"], i % 3, 1 + Math.floor(i / 3))),
    ]),
    workflow("taobao-main", "淘宝主图", "服饰", "019ba2a6731f420a", ["服装图片", "模特全身照"], "换装后制作主图与场景展示", [
        product(),
        model(),
        step("outfit", "AI 换装", "让模特自然穿着参考服装，完整呈现商品。", ["model", "product"], 0, 1, "outfit"),
        step("hero", "电商主图", "基于参考试穿图制作干净的方形电商主图，商品突出，不加文字。", ["outfit"], 0, 2),
        step("lifestyle", "场景展示", "基于同一试穿图制作自然生活方式场景照片。", ["outfit"], 1, 2),
    ]),
    workflow("product-retouch", "产品一键精修", "商品", "69fa9c6e2b0c004b", ["商品图片"], "商品精修、局部特写与角度展示", [
        product(),
        ...["正面精修", "侧面展示", "局部特写"].map((p, i) => step(`retouch-${i}`, p, `制作商品${p}图，修正曝光与杂乱背景，保留真实质感。不可见结构不补造。`, ["product"], i)),
        step("upscale", "高清放大", "提升清晰度与细节。", ["retouch-0"], 0, 2, "upscale"),
    ]),
    workflow("interior-outfit", "商业内景换装", "服饰", "d0cf0cc8b765e490", ["服装", "模特", "室内场景"], "同款穿搭生成多种商业内景画面", [
        product(),
        model(),
        scene(),
        step("outfit", "AI 换装", "将模特换上商品服装，身份与体型一致。", ["model", "product"], 0, 1, "outfit"),
        ...["窗边自然光", "沙发休闲坐姿", "走廊全身站姿"].map((p, i) => step(`interior-${i}`, p, `在参考室内场景制作${p}穿搭大片。`, ["outfit", "scene"], i, 2)),
    ]),
    workflow("outfit-pose", "模特一键换装换姿势", "服饰", "81d53bf231e3b1a3", ["模特", "服装", "姿势参考"], "换装后连接姿势参考，保持同人同款", [
        product(),
        model(),
        upload("pose-ref", "上传姿势参考", 2),
        step("outfit", "AI 换装", "模特穿上商品服装。", ["model", "product"], 0, 1, "outfit"),
        step("pose", "姿势参考", "让已换装模特采用姿势参考图中的动作，保持人物一致。", ["outfit", "pose-ref"], 0, 2, "pose"),
    ]),
    workflow(
        "womenswear",
        "电商女装模特展示与视频",
        "服饰",
        "db6a8117e9c96238",
        ["女装图片", "模特照片"],
        "换装、三视图与动态视频制作链路",
        [
            product(),
            model(),
            step("outfit", "AI 换装", "制作真实女装试穿图。", ["model", "product"], 0, 1, "outfit"),
            step("views", "模特三视图", "展示同款女装正面、侧面和背面。", ["outfit"], 0, 2, "model-views"),
            step("video", "视频生成", "自然转身展示服装。", ["outfit"], 1, 2, "product-video"),
        ],
    ),
    workflow("fashion-suite", "电商服装整套内容", "服饰", "6825c070aba3061b", ["服装整体图", "模特照片", "真实细节图"], "主图、三视图、场景图和细节图组成一组", [
        product(),
        model(),
        upload("detail", "上传细节图片", 2),
        step("outfit", "AI 换装", "生成完整试穿图。", ["model", "product"], 0, 1, "outfit"),
        step("views", "模特三视图", "同一模特三视图。", ["outfit"], 0, 2, "model-views"),
        step("scene", "场景主图", "自然室内全身商业摄影。", ["outfit"], 1, 2),
        step("details", "服装细节", "真实面料与缝线特写。", ["product", "detail"], 2, 2),
    ]),
    workflow("product-views", "产品三视图生成", "商品", "551c97310fd0a785", ["产品正面、侧面、背面参考"], "按真实多角度素材制作统一三视图", [
        product(),
        upload("side", "上传侧面参考", 1),
        upload("back", "上传背面参考", 2),
        step("views", "产品三视图", "基于三张真实角度参考，制作正面、侧面、背面等比例排列的商品三视图，统一光线与背景。", ["product", "side", "back"]),
    ]),
    workflow("kids-video", "童装变装视频复刻", "视频", "ec0c6f42ab2c4442", ["已获授权的模特照片", "童装商品", "参考视频"], "童装试穿后复刻参考视频", [
        product(),
        model(),
        reference(),
        step("outfit", "童装试穿", "保持模特年龄外观与正常童装穿着，制作自然试穿图。", ["model", "product"], 0, 1, "outfit"),
        step("video", "模特 / 商品替换", "复刻参考视频节奏并使用已换装模特。", ["outfit", "reference"], 0, 2, "video-replace"),
    ]),
    workflow("face-video", "换脸复刻", "视频", "9b4d199abd1041fa", ["已获授权的人物照片", "参考视频"], "人物参考与原视频连接到替换节点", [
        upload("person", "上传人物参考", 0),
        reference(),
        { ...step("video", "模特 / 商品替换", "替换为已授权的参考人物，保持原视频场景与动作。", ["person", "reference"], 0, 1, "video-replace"), videoKind: "face" },
    ]),
    workflow("person-product-video", "换人换脸换产品复刻", "视频", "43be9ca1e69274d4", ["人物照片", "商品图片", "参考视频"], "人物与商品素材共同驱动视频复刻", [
        product(),
        model(),
        reference(),
        { ...step("video", "模特 / 商品替换", "使用参考人物与商品，复刻原视频的镜头和动作。", ["model", "product", "reference"], 0, 1, "video-replace"), videoKind: "combination" },
    ]),
    workflow("motion-video", "视频动作迁移", "视频", "50374ab3e657ffcf", ["人物照片", "参考视频"], "保留人物形象，参考视频动作与运镜", [
        model(),
        reference(),
        step("video", "模特 / 商品替换", "参考视频动作、节奏与镜头，保持目标人物外观。", ["model", "reference"], 0, 1, "video-replace"),
    ]),
    workflow("outfit-video", "换装视频", "视频", "24e62499a8a005c3", ["服装", "模特", "参考视频"], "生成试穿图后接入视频复刻", [
        product(),
        model(),
        reference(),
        step("outfit", "AI 换装", "将模特换上整套参考服装。", ["model", "product"], 0, 1, "outfit"),
        step("video", "模特 / 商品替换", "使用试穿图复刻参考视频。", ["outfit", "reference"], 0, 2, "video-replace"),
    ]),
    workflow(
        "tvc",
        "TVC 商品广告分镜",
        "商品",
        "1389c8698d1dc219",
        ["商品图", "品牌与卖点文案"],
        "建立广告开场、核心卖点与产品定帧",
        [
            product(),
            { id: "brief", type: "text", text: "品牌：\n核心卖点：\n广告受众：\n视觉风格：", x: 80, y: 500 },
            ...["开场氛围", "商品卖点特写", "产品定帧"].map((p, i) => step(`shot-${i}`, p, `创作品牌广告的${p}分镜，统一光线与视觉风格，不虚构功效。`, ["product", "brief"], i)),
        ],
        "当前提供图片分镜；一键成片敬请期待。",
    ),
    workflow("virtual-model", "AI 虚拟模特融合", "服饰", "8a90b09bae6ec111", ["模特参考", "服装商品"], "模特与服装融合，扩展多角度展示", [
        product(),
        model(),
        step("fusion", "AI 换装", "融合参考模特与服装，自然合身、真实面料。", ["model", "product"], 0, 1, "outfit"),
        step("views", "模特三视图", "保持同一虚拟模特的三视图。", ["fusion"], 0, 2, "model-views"),
    ]),
];
