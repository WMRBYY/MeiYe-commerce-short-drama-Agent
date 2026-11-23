const listeners = new Map<Element, Set<() => void>>();
let observer: IntersectionObserver | null = null;

/** Share one observer across media nodes and release each target after first visibility. */
export function observeCanvasMediaVisibility(element: Element, onVisible: () => void): () => void {
    if (typeof IntersectionObserver === "undefined") {
        onVisible();
        return () => {};
    }
    observer ??= new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const callbacks = listeners.get(entry.target);
            if (!callbacks) continue;
            listeners.delete(entry.target);
            observer?.unobserve(entry.target);
            callbacks.forEach((callback) => callback());
        }
        releaseIdleObserver();
    }, { rootMargin: "600px" });
    let callbacks = listeners.get(element);
    if (!callbacks) {
        callbacks = new Set();
        listeners.set(element, callbacks);
        observer.observe(element);
    }
    callbacks.add(onVisible);
    return () => {
        const current = listeners.get(element);
        if (current !== callbacks) return;
        current.delete(onVisible);
        if (!current.size) {
            listeners.delete(element);
            observer?.unobserve(element);
        }
        releaseIdleObserver();
    };
}

function releaseIdleObserver() {
    if (listeners.size) return;
    observer?.disconnect();
    observer = null;
}
