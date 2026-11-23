import type { ComponentProps } from "react";
import { CreditStar } from "@/components/ui/credit-star";

export { requestCreditCost } from "@/lib/model-pricing";

export function CreditSymbol({ className, ...props }: ComponentProps<"span">) {
    return (
        <span {...props} className={`inline-flex items-center justify-center ${className || ""}`}>
            <CreditStar className="size-[1em]" />
        </span>
    );
}

export function formatCredits(value: number, maximumFractionDigits = 6) {
    return (value / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits });
}
