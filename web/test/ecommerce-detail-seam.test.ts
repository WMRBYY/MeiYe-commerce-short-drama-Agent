import { expect, test } from "bun:test";
import { matchDetailEdge } from "@/pages/ecommerce/detail-seam";

test("a horizontal gradient joins at every column, keeping text and pixels beyond the transition intact", () => {
    const width = 80, half = 10, rgba = new Uint8ClampedArray(width * half * 2 * 4);
    const at = (x: number, y: number) => (y * width + x) * 4;
    for (let y = 0; y < 2 * half; y++) for (let x = 0; x < width; x++) {
        const shade = 70 + x + (y < half ? 0 : 60);
        rgba.set([shade, shade - 10, 180, 255], at(x, y));
    }
    const letter = at(40, half + 4);
    rgba.set([12, 12, 12, 255], letter);
    const original = rgba.slice();
    matchDetailEdge(rgba, width, half);
    for (let x = 0; x < width; x++) {
        const end = at(x, half-1), start = at(x, half);
        expect([...rgba.slice(end,end+4)]).toEqual([...rgba.slice(start,start+4)]);
    }
    expect(rgba.slice(letter, letter+4)).toEqual(original.slice(letter, letter+4));
    expect(rgba.slice(0,width*4)).toEqual(original.slice(0,width*4));
    expect(rgba.slice(-width*4)).toEqual(original.slice(-width*4));
});
