import type { EcommercePlanImage } from "@/services/api/ecommerce";

type Box = { x: number; y: number; width: number; height: number };
export type CommerceLayoutContract = { heading: Box; artwork: Box; information: Box; columns: number; rows: number; groups: string[] };

/** Allocate space from the actual copy, never from an unfilled example card count. */
export function commerceLayoutContract(image: Pick<EcommercePlanImage, "copy" | "ratio" | "informationComponent">): CommerceLayoutContract {
    const paragraphs = image.copy.trim().split(/\r?\n\s*\r?\n/).map((part) => part.trim()).filter(Boolean);
    const lines = (paragraphs[0] || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    // Older reviewed plans use a blank line between cards and put each card's
    // label and explanation on two lines. They remain one card, not two.
    const groups = [...lines.slice(2), ...paragraphs.slice(1)];
    const parts = image.ratio.split(/[:x×]/).map(Number);
    const wide = parts.length === 2 && parts[0] / parts[1] >= 1.2;
    const columns = groups.length > 1 && groups.length <= 4 ? 2 : 1;
    const rows = Math.max(1, Math.ceil(groups.length / columns));
    const infoHeight = groups.length ? Math.min(36, 12 + rows * 6) : 0;
    const layout = {
        heading: { x: 12, y: 10, width: 76, height: wide ? 24 : 18 },
        artwork: { x: 10, y: wide ? 38 : 32, width: 80, height: (groups.length ? 86 - infoHeight - 4 : 88) - (wide ? 38 : 32) },
        information: { x: 12, y: 88 - infoHeight, width: 76, height: infoHeight },
        columns, rows, groups,
    };
    if (!groups.length && /^(场景注释|留白收束)[｜:：]/.test(image.informationComponent || "")) {
        layout.heading.y = 88 - layout.heading.height;
        layout.artwork.y = 10;
        layout.artwork.height = layout.heading.y - 16;
    }
    return layout;
}

export function commerceLayoutInstruction(image: Pick<EcommercePlanImage, "copy" | "ratio" | "informationComponent">, preserveLayout = false) {
    const layout = commerceLayoutContract(image);
    const rect = (b: Box) => `x=${b.x}%–${b.x + b.width}%，y=${b.y}%–${b.y + b.height}%`;
    const groups = layout.groups.length
        ? `辅助信息区 ${rect(layout.information)}，只放文案中实际存在的 ${layout.groups.length} 组信息，按 ${layout.columns} 列、${layout.rows} 行排列。`
        : "文案没有辅助信息，不添加底部卡片或图标条，商品区域保留足够留白。";
    const zoom = image.informationComponent?.startsWith("细节放大窗") && layout.groups.length
        ? "辅助信息区内采用最多两个真实局部放大图加对应短说明；图片、说明和引线的完整外框共同留在各自单元格内。" : "";
    const regions = preserveLayout
        ? "继承用户参考版式的阅读顺序、组件和视觉风格，将越界元素向内重排；不采用下面的默认分区。全部文字和组件的完整外框须在 x=12%–88%、y=10%–90% 内。"
        : `本张按 ${image.ratio} 原生画幅分区，以下坐标是占完整画布的百分比，不绘制坐标或分区线：标题与副标题区 ${rect(layout.heading)}；商品与场景区 ${rect(layout.artwork)}；${groups}${zoom}标题先按栏宽换行再选字号，不横向放大到边界。辅助信息放在独立区域，不与商品争抢同一侧栏；图标、编号、描边、阴影和引线均完整内收。`;
    return [
        "【本张唯一排版合同】本段是文字与组件位置的唯一依据；摄影简报只约束商品、机位、场景和光线，其中的标题位置、贴边、大字、侧栏、放大窗数量不再作为排版指令。",
        regions,
        "只继承本套的配色、字体、图形形状和摄影风格，不把整套其他页面的构图复制到本张。",
        image.informationComponent ? `组件语言：${image.informationComponent.split(/[｜:：]/)[0]}；具体位置与数量服从本合同。` : "",
        "逐字保留本张成品文案，不为凑卡片数量补字、复制文案或制造空卡片。空间不足时先减少装饰、缩小商品占比、增加文字换行；不得裁字、截断组件或用极小字体硬塞。",
    ].filter(Boolean).join("\n");
}

/** Old saved plans contain repeated server guards. Keep those safeguards once
 * in the final prompt, and remove their conflicting UI directions from the photo brief. */
export function commercePhotographyBrief(prompt: string) {
    const content = prompt.includes("【本屏具体内容】") ? prompt.split("【本屏具体内容】").slice(1).join("【本屏具体内容】") : prompt;
    const blocks = content.split(/(?=【[^】]+】)/);
    const duplicate = /^【(?:真人商业摄影执行|留白与防裁切|本屏唯一拍摄要求)/;
    const ui = /(?:text area\s*:|headline|subtitle|typograph|callout|inset|information card|text block|linear icon|主标题|副标题|文字区|文案区|放大窗|放大框|信息卡|字号|斜切大字|左侧排版|右侧排版)/i;
    return blocks.filter((block) => !duplicate.test(block)).map((block) => block.split(/(?<=[。；;])\s*|(?<=[.!?])\s+|\n/).filter((sentence) => !ui.test(sentence)).join("\n")).filter((block) => block.trim()).join("\n").trim();
}

export function commerceSeriesVisualBrief(strategy: string) {
    return strategy.split(/(?<=[。；;])\s*|(?<=[.!?])\s+|\n/).filter((sentence) => !/第[一二三四五六七八九十\d]+[页屏]|(?:page|screen)\s*\d/i.test(sentence)).join("\n").trim();
}
