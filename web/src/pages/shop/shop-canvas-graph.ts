export type CommerceGraphNode = { id: string; inputs?: string[]; managedInputIds?: string[]; type: string; resourceId?: string; text?: string; draftKind?: string; materialCategory?: string };

export type ShopCanvasReferenceInput = {
    nodeId?: string;
    resourceId?: string;
    kind: "image" | "video" | "audio" | "text";
    name?: string;
    materialCategory?: string;
};

export function connectCommerceNodes<T extends CommerceGraphNode>(nodes: T[], source: string, target: string): { nodes: T[]; error?: string } {
    const from = nodes.find((n) => n.id === source),
        to = nodes.find((n) => n.id === target);
    if (!from || !to) return { nodes, error: "连接的节点已不存在" };
    if (source === target) return { nodes, error: "节点不能连接自己" };
    if (to.inputs?.includes(source)) return { nodes, error: "这两个节点已经连接" };
    const visited = new Set<string>();
    const dependsOn = (id: string): boolean => {
        if (id === target) return true;
        if (visited.has(id)) return false;
        visited.add(id);
        return (nodes.find((n) => n.id === id)?.inputs || []).some(dependsOn);
    };
    if (dependsOn(source)) return { nodes, error: "连接会形成循环，请调整方向" };
    return { nodes: nodes.map((n) => (n.id === target ? { ...n, inputs: [...(n.inputs || []), source] } : n)) };
}

/** Designer inputs own only the edges that they created. Existing manual connections keep their ownership. */
export function syncShopCanvasReferences<T extends CommerceGraphNode>(nodes: T[], targetId: string, references: readonly ShopCanvasReferenceInput[], makeSource: (reference: ShopCanvasReferenceInput, nodes: T[], index: number) => T, append = false): T[] {
    const target = nodes.find((node) => node.id === targetId);
    if (!target) return nodes;

    const previous = target.inputs || [];
    const previousManaged = new Set(target.managedInputIds);
    const managed = append ? previous.filter((id) => previousManaged.has(id)) : [];
    const independent = append ? previous : previous.filter((id) => !previousManaged.has(id));
    let updated = independent.length === previous.length ? nodes : nodes.map((node) => (node === target ? { ...node, inputs: independent } : node));
    const linked = new Set(independent);

    for (const [index, reference] of references.entries()) {
        const matchesKind = (node: T) => node.type === reference.kind || (reference.kind === "image" && node.type === "generation");
        const selected = reference.nodeId ? updated.find((node) => node.id === reference.nodeId) : undefined;
        if (selected && (!matchesKind(selected) || selected.id === targetId || (reference.resourceId && selected.resourceId !== reference.resourceId))) continue;
        let source = selected;
        if (!source && reference.kind !== "text" && reference.resourceId) {
            const matchesResource = (node: T) => node.id !== targetId && matchesKind(node) && node.resourceId === reference.resourceId && node.materialCategory === reference.materialCategory;
            source = updated.find((node) => previous.includes(node.id) && matchesResource(node)) || updated.find(matchesResource);
            if (!source) {
                source = makeSource(reference, updated, index);
                updated = [...updated, source];
            }
        }
        if (!source || linked.has(source.id)) continue;
        const result = connectCommerceNodes(updated, source.id, targetId);
        if (result.error) continue;
        updated = result.nodes;
        linked.add(source.id);
        managed.push(source.id);
    }

    const sameOrder = (a: string[], b: string[]) => a.length === b.length && a.every((id, index) => id === b[index]);
    const active = [...linked];
    if (updated.length === nodes.length && sameOrder(active, previous) && sameOrder(managed, target.managedInputIds || [])) return nodes;
    return updated.map((node) => (node.id === targetId ? { ...node, inputs: active, managedInputIds: managed.length ? managed : undefined } : node));
}

/** 只把上游实际存在的素材和文字交给生成；未完成节点不伪装成参考图。 */
export function commerceNodeReferences(nodes: CommerceGraphNode[], target: string) {
    const visited = new Set<string>();
    const references: CommerceGraphNode[] = [];
    const visit = (id: string) => {
        if (visited.has(id)) return;
        visited.add(id);
        const node = nodes.find((n) => n.id === id);
        if (!node) return;
        if (node.resourceId || node.type === "text") references.push(node);
        else node.inputs?.forEach(visit);
    };
    nodes.find((n) => n.id === target)?.inputs?.forEach(visit);
    return references;
}

export function commerceConnectionPath(from: { x: number; y: number }, to: { x: number; y: number }) {
    const bend = Math.max(56, Math.abs(to.x - from.x) * 0.48);
    return `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`;
}

/** Replace unchanged linked content while retaining manual edits and uploads. */
export function reconcileCommerceLinks(previous: string | undefined, references: CommerceGraphNode[], text: string) {
    let prior: Array<[string, string | null, string | null]> = [];
    try {
        const parsed: unknown = JSON.parse(previous || "[]");
        if (Array.isArray(parsed)) prior = parsed.filter((row) => Array.isArray(row) && typeof row[0] === "string");
    } catch {
        // An older malformed snapshot must not erase the user's current draft.
    }
    const oldText = prior
        .map((row) => row[2])
        .filter(Boolean)
        .join("\n");
    const newText = references
        .filter((node) => node.type === "text")
        .map((node) => node.text)
        .filter(Boolean)
        .join("\n");
    let manual = text;
    if (oldText && oldText !== newText) {
        if (manual === oldText) manual = "";
        else if (manual.endsWith(`\n${oldText}`)) manual = manual.slice(0, -oldText.length - 1);
    }
    const alreadyIncluded = newText && (manual === newText || manual.endsWith(`\n${newText}`));
    return {
        text: newText && !alreadyIncluded ? [manual, newText].filter(Boolean).join("\n") : manual,
        previousResourceIds: new Set(prior.map((row) => row[1]).filter((id): id is string => typeof id === "string" && Boolean(id))),
    };
}
