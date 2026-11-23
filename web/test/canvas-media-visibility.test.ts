import { afterAll, expect, test } from "bun:test";
import { observeCanvasMediaVisibility } from "../src/lib/canvas/canvas-media-visibility";

const original = Object.getOwnPropertyDescriptor(globalThis, "IntersectionObserver");
const instances: VisibilityObserver[] = [];
class VisibilityObserver {
    targets = new Set<Element>();
    disconnected = false;
    constructor(public callback: IntersectionObserverCallback, public options: IntersectionObserverInit) { instances.push(this); }
    observe(target: Element) { this.targets.add(target); }
    unobserve(target: Element) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); this.disconnected = true; }
    emit(target: Element, isIntersecting: boolean) {
        this.callback([{ target, isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
}
Object.defineProperty(globalThis, "IntersectionObserver", { configurable: true, writable: true, value: VisibilityObserver });
afterAll(() => {
    if (original) Object.defineProperty(globalThis, "IntersectionObserver", original);
    else Reflect.deleteProperty(globalThis, "IntersectionObserver");
});

test("720 media targets share one observer and only load once near the viewport", () => {
    const targets = Array.from({ length: 720 }, () => ({} as Element));
    let visible = 0;
    const cleanups = targets.map((target) => observeCanvasMediaVisibility(target, () => visible++));
    expect(instances).toHaveLength(1);
    const observer = instances[0];
    expect(observer.options.rootMargin).toBe("600px");
    expect(observer.targets.size).toBe(720);
    observer.emit(targets[0], false);
    expect(visible).toBe(0);
    observer.emit(targets[0], true);
    observer.emit(targets[0], true);
    expect(visible).toBe(1);
    expect(observer.targets.size).toBe(719);
    cleanups.forEach((cleanup) => cleanup());
    expect(observer.disconnected).toBe(true);
    expect(observer.targets.size).toBe(0);
});

test("independent listeners survive cleanup and remounts on the same element", () => {
    const target = {} as Element;
    const calls: string[] = [];
    const first = observeCanvasMediaVisibility(target, () => calls.push("first"));
    const second = observeCanvasMediaVisibility(target, () => calls.push("second"));
    first();
    instances.at(-1)!.emit(target, true);
    expect(calls).toEqual(["second"]);
    const third = observeCanvasMediaVisibility(target, () => calls.push("third"));
    second();
    expect(instances.at(-1)!.targets.has(target)).toBe(true);
    instances.at(-1)!.emit(target, true);
    expect(calls).toEqual(["second", "third"]);
    third();
    expect(instances.at(-1)!.disconnected).toBe(true);
});
