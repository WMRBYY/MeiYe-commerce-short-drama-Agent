import { createContext, type ReactNode } from "react";
import type { CanvasNodeData } from "@/types/canvas";

export type CanvasCommerceContextValue = {
    activeNodeId: string | null;
    renderExpanded: (node: CanvasNodeData) => ReactNode;
};

export const CanvasCommerceContext = createContext<CanvasCommerceContextValue | null>(null);
