export type CanvasNodeRenderLOD = "shell" | "preview" | "full";

// Hysteresis prevents mounting/unmounting editors around the overview boundary.
export function canvasOverviewMode(scale: number, previous: boolean) {
    return previous ? scale < 0.27 : scale < 0.23;
}

// A dense viewport should not mount hundreds of editors just because it is
// zoomed in. Hysteresis avoids rebuilding them while panning at the boundary.
export function canvasDenseOverviewMode(visibleNodeCount: number, previous: boolean) {
    return previous ? visibleNodeCount >= 72 : visibleNodeCount >= 100;
}

export function resolveCanvasNodeLOD(overview: boolean, inView: boolean, inEntry: boolean, editing: boolean): CanvasNodeRenderLOD {
    if (editing) return "full";
    if (inView) return overview ? "preview" : "full";
    return inEntry ? "preview" : "shell";
}
