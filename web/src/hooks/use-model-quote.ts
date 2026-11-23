import { useEffect, useState } from "react";

import { quoteModel, type LogicalModelQuote, type ModelQuoteRequest } from "@/services/api/logical-models";
import { useUserStore } from "@/stores/use-user-store";

export function useModelQuote(request: ModelQuoteRequest | undefined, enabled: boolean, pricing?: unknown) {
    const userId = useUserStore((state) => state.user?.id);
    const requestKey = request ? JSON.stringify(request) : "";
    const pricingKey = pricing ? JSON.stringify(pricing) : "";
    const key = `${userId || ""}\u0000${requestKey}\u0000${pricingKey}`;
    const [result, setResult] = useState<{ key: string; quote: LogicalModelQuote | null } | null>(null);

    useEffect(() => {
        if (!userId || !enabled || !requestKey) return;
        const controller = new AbortController();
        setResult({ key, quote: null });
        quoteModel(JSON.parse(requestKey) as ModelQuoteRequest, controller.signal)
            .then(({ quote }) => {
                if (!controller.signal.aborted) setResult({ key, quote });
            })
            .catch(() => {
                if (!controller.signal.aborted) setResult({ key, quote: null });
            });
        return () => controller.abort();
    }, [enabled, key, requestKey, userId]);

    return userId && enabled && result?.key === key ? result.quote : null;
}
