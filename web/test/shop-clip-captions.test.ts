import { describe, expect, test } from "bun:test";
import { canSplitClipSubtitle, emptyCaptionHistory, insertClipSubtitle, moveCaptionHistory, recordCaptionEdit, splitClipSubtitle } from "../src/pages/shop/clip/clip-captions";

describe("字幕新增与拆分", () => {
    test("空表能添加，优先使用开头或中间空档，不能覆盖现有字幕", () => {
        expect(insertClipSubtitle([], 1500)).toEqual({ transcript: [{ startMs: 0, endMs: 1500, text: "" }], index: 0 });
        const captions = [{ startMs: 500, endMs: 1000, text: "原字幕" }];
        expect(insertClipSubtitle(captions, 3000)?.transcript[0]).toEqual({ startMs: 0, endMs: 500, text: "" });
        const middle = [
            { startMs: 0, endMs: 500, text: "前句" },
            { startMs: 1000, endMs: 3000, text: "后句" },
        ];
        expect(insertClipSubtitle(middle, 3000)).toEqual({ transcript: [middle[0], { startMs: 500, endMs: 1000, text: "" }, middle[1]], index: 1 });
        expect(insertClipSubtitle([{ startMs: 0, endMs: 3000, text: "占满时间" }], 3000)).toBeNull();
        expect(insertClipSubtitle([], NaN)).toBeNull();
        expect(insertClipSubtitle([], 50)).toBeNull();
    });
    test("光标拆分保留全部文字、时间端点和其他句子，Unicode不被切坏", () => {
        const original = [
            { startMs: 200, endMs: 3200, text: "杯😀轻便" },
            { startMs: 4000, endMs: 5000, text: "下一句" },
        ];
        const split = splitClipSubtitle(original, 0, 3)!;
        expect(split).toEqual([{ startMs: 200, endMs: 1700, text: "杯😀" }, { startMs: 1700, endMs: 3200, text: "轻便" }, original[1]]);
        expect(split[0].text + split[1].text).toBe(original[0].text);
        expect(original[0].endMs).toBe(3200);
    });
    test("没有光标时优先标点，长句可逐步拆分且不截断", () => {
        const original = [{ startMs: 0, endMs: 10000, text: "上半句商品介绍，下半句产品细节" }];
        const split = splitClipSubtitle(original, 0)!;
        expect(split[0].text).toBe("上半句商品介绍，");
        expect(split.map((line) => line.text).join("")).toBe(original[0].text);
        const long = [{ startMs: 0, endMs: 10000, text: "字".repeat(150) }];
        const halves = splitClipSubtitle(long, 0)!;
        expect(halves.map((line) => line.text.length)).toEqual([75, 75]);
        expect(halves[0].endMs).toBe(halves[1].startMs);
    });
    test("光标落在组合字符、肤色、ZWJ或旗帜内部时保持整个字形", () => {
        for (const grapheme of ["e\u0301", "👍🏽", "👩🏽‍💻", "🇨🇳"]) {
            const original = [{ startMs: 0, endMs: 2000, text: grapheme + "好" }];
            for (let cursor = 1; cursor < grapheme.length; cursor++) {
                expect(splitClipSubtitle(original, 0, cursor)).toEqual([
                    { startMs: 0, endMs: 1000, text: grapheme },
                    { startMs: 1000, endMs: 2000, text: "好" },
                ]);
            }
            expect(canSplitClipSubtitle([{ ...original[0], text: " " + grapheme + " " }], 0)).toBe(false);
        }
        expect(splitClipSubtitle([{ startMs: 200, endMs: 3200, text: "前👩🏽‍💻后" }], 0, 4)).toEqual([
            { startMs: 200, endMs: 1200, text: "前" },
            { startMs: 1200, endMs: 3200, text: "👩🏽‍💻后" },
        ]);
        expect(splitClipSubtitle([{ startMs: 0, endMs: 2000, text: "🇨🇳🇺🇸" }], 0, 2)?.map((line) => line.text)).toEqual(["🇨🇳", "🇺🇸"]);
    });
    test("空白和过短时间不能拆出无效字幕，临界时间保留100毫秒", () => {
        for (const text of [" ", " 字 ", "字"]) expect(canSplitClipSubtitle([{ startMs: 0, endMs: 1000, text }], 0)).toBe(false);
        expect(splitClipSubtitle([{ startMs: 0, endMs: 199, text: "两字" }], 0)).toBeNull();
        const split = splitClipSubtitle([{ startMs: 0, endMs: 200, text: "许多文字" }], 0, 1)!;
        expect(split[0].endMs).toBe(100);
        expect(split[1].endMs - split[1].startMs).toBe(100);
    });
});

describe("字幕撤销记录", () => {
    test("连续文字编辑合为一步，删除可撤销重做，新修改丢弃重做分支", () => {
        const original = [{ startMs: 0, endMs: 1000, text: "原句" }];
        const first = [{ ...original[0], text: "修改" }];
        const second = [{ ...original[0], text: "修改完成" }];
        let history = recordCaptionEdit(emptyCaptionHistory(), original, first, "text:0");
        history = recordCaptionEdit(history, first, second, "text:0");
        expect(history.past).toHaveLength(1);
        history = recordCaptionEdit(history, second, []);
        const undoDelete = moveCaptionHistory(history, [], "undo")!;
        expect(undoDelete.transcript).toEqual(second);
        const undoText = moveCaptionHistory(undoDelete.history, undoDelete.transcript, "undo")!;
        expect(undoText.transcript).toEqual(original);
        const redo = moveCaptionHistory(undoText.history, original, "redo")!;
        expect(redo.transcript).toEqual(second);
        const changed = recordCaptionEdit(redo.history, second, first, "text:0");
        expect(changed.future).toEqual([]);
    });
    test("历史复制文本与时间快照，不被后续编辑覆盖", () => {
        const original = [{ startMs: 0, endMs: 1000, text: "原句" }];
        const history = recordCaptionEdit(emptyCaptionHistory(), original, []);
        original[0].text = "后来修改";
        expect(moveCaptionHistory(history, [], "undo")?.transcript[0].text).toBe("原句");
    });
});
