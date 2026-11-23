import { CreditStar } from "@/components/ui/credit-star";
import { cn } from "@/lib/utils";

/** 画布积分入口沿用余额栏的四角星。 */
export function WorkspaceCreditGiftMark({ className }: { className?: string }) {
    return (
        <span className={cn("app-workspace-credit-gift", className)} aria-hidden="true">
            <CreditStar />
        </span>
    );
}
