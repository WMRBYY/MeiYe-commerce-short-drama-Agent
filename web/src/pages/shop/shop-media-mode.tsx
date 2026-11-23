import { ImageIcon, Video } from "lucide-react";
import { useLocation, useNavigate } from "react-router";

import { SegmentedControl } from "@/components/ui/base/segmented-control/segmented-control";
import type { EcommerceWorkRemix } from "@/services/api/canvas-templates";

export type ShopMediaNavigationState = {
    workRemix?: EcommerceWorkRemix;
    workRemixOwner?: string;
};

export function ShopMediaMode({ value }: { value: "image" | "video" }) {
    const location = useLocation();
    const navigate = useNavigate();
    const navigationState = location.state as ShopMediaNavigationState | null;
    return (
        <div className="sim-mode">
            <SegmentedControl
                className="sim-mode-capsule"
                value={value}
                ariaLabel="创作类型"
                options={[
                    { value: "image", label: "图片", icon: <ImageIcon className="size-4" /> },
                    { value: "video", label: "视频", icon: <Video className="size-4" /> },
                ]}
                onChange={(next) => {
                    const query = new URLSearchParams(location.search);
                    if (next === "video") query.set("media", "video");
                    else query.delete("media");
                    navigate({ pathname: location.pathname, search: query.toString() ? `?${query}` : "" }, { replace: true, state: navigationState });
                }}
            />
        </div>
    );
}
