import { AudioLines, Clapperboard, Images } from "lucide-react";
import type { MouseEvent } from "react";
import { IconButton } from "@/components/ui/base/buttons/icon-button";
import { AntTooltip } from "@/components/ui/base/tooltip/ant-tooltip";
import "./shop-material-library.css";

/** 上传位下的素材库入口；不接管上传卡片的本地文件选择。 */
export function ShopMaterialLibraryButton({
    label,
    kind = "image",
    disabled,
    disabledReason,
    onClick,
}: {
    label: string;
    kind?: "image" | "video" | "audio";
    disabled?: boolean;
    disabledReason?: string;
    onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
    return (
        <span className="shop-material-library-action" data-canvas-no-zoom>
            <AntTooltip title={disabled ? disabledReason || "已达上限，请先移除一张图片" : label}>
                <span>
                    <IconButton
                        icon={kind === "video" ? Clapperboard : kind === "audio" ? AudioLines : Images}
                        variant="default"
                        size="sm"
                        aria-label={label}
                        aria-haspopup="dialog"
                        disabled={disabled}
                        onPointerDown={(event) => event.stopPropagation()}
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                            event.stopPropagation();
                            onClick(event);
                        }}
                    />
                </span>
            </AntTooltip>
        </span>
    );
}
