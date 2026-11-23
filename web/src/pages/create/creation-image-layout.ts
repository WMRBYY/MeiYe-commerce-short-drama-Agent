/** Similar visual area across ratios, bounded for the conversation viewport. */
export function creationImageLayout(ratio: number) {
    const value = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
    const width = Math.min(480, 400 * value, Math.sqrt(88000 * value));
    return { width, height: width / value, ratio: value };
}
