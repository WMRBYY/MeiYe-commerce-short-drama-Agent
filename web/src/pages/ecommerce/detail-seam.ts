// Match the background on either side of a join without moving a single row.
// Work column by column: a horizontal gradient or a diagonal has no single edge colour.
export function matchDetailEdge(data: Uint8ClampedArray, width: number, half: number) {
    const stride = width * 4;
    for (let x = 0; x < width; x++) {
        const top = (half - 1) * stride + x * 4, bottom = top + stride;
        const delta = [0, 1, 2].map(c => (data[bottom + c] - data[top + c]) / 2);
        const upper = data.slice(top, top + 3), lower = data.slice(bottom, bottom + 3);
        if (data[top + 3] !== 255 || data[bottom + 3] !== 255) continue;
        // Protect ink/objects hitting the cut: a large change just inside the
        // same image is a contour, rather than two differently lit backgrounds.
        const inset = Math.min(half - 1, Math.max(1, Math.round(width / 240))) * stride;
        const contrast = Math.max(...delta.map((_, c) => Math.max(Math.abs(data[top - inset + c] - upper[c]), Math.abs(data[bottom + inset + c] - lower[c]))));
        const confidence = Math.max(0, Math.min(1, (42 - contrast) / 24));
        if (!confidence) continue;
        const mismatch = Math.max(...delta.map(Math.abs)) * 2;
        if (mismatch <= 2) continue;
        // One continuous S-curve across both screens. Two independent fades
        // flatten at their midpoint and leave a perceptible stripe there.
        const reach = Math.min(half - 1, Math.max(3, Math.round(width * (0.035 + Math.min(1, mismatch / 125) * 0.115))));
        for (let d = 0; d < reach; d++) {
            const t = (1 - d / reach) / 2;
            const weight = 2 * t * t * (3 - 2 * t) * confidence;
            for (let side = 1; side >= -1; side -= 2) {
                const edge = side === 1 ? upper : lower, i = side === 1 ? top - d * stride : bottom + d * stride;
                const distance = Math.max(Math.abs(data[i] - edge[0]), Math.abs(data[i+1] - edge[1]), Math.abs(data[i+2] - edge[2]));
                const mix = weight * Math.max(0, Math.min(1, (55 - distance) / 30));
                for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c] + side * mix * delta[c]);
            }
        }
    }
}

type Source = ImageBitmap | HTMLImageElement;
export function paintDetailJoin(canvas: HTMLCanvasElement, above: Source, below: Source, width: number) {
    const size = (im: Source) => "naturalWidth" in im ? [im.naturalWidth, im.naturalHeight] : [im.width, im.height];
    const [aw, ah] = size(above), [bw, bh] = size(below);
    if (!aw || !bw || !width) return false;
    const half = Math.min(Math.max(2, Math.ceil(width * 0.15) + 1), Math.floor(ah * width / aw / 2), Math.floor(bh * width / bw / 2));
    if (half < 2) return false;
    canvas.width = width;
    canvas.height = half * 2;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(above, 0, ah - half * aw / width, aw, half * aw / width, 0, 0, width, half);
    ctx.drawImage(below, 0, 0, bw, half * bw / width, 0, half, width, half);
    const pixels = ctx.getImageData(0, 0, width, half * 2);
    matchDetailEdge(pixels.data, width, half);
    ctx.putImageData(pixels, 0, 0);
    return true;
}
