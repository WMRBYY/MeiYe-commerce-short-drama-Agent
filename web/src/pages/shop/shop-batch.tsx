import TryOnStudio from "@/pages/ecommerce/tryon/tryon-studio";

import { SHOP_MARKET, useShopFunction, useShopScope } from "./shop-context";

/** 批量：完整的批量换装面板（全部高级选项），与生图页共用草稿和作品。 */
export default function ShopBatch() {
    const scope = useShopScope();
    const { fn, allowed, pick } = useShopFunction();
    return (
        <div className="sp-page sp-batch ms-scope">
            <TryOnStudio
                scope={scope}
                fn={fn}
                allowed={allowed}
                market={SHOP_MARKET}
                onPickFunction={pick}
                kindSwitch={
                    <div className="sp-video-head">
                        <i />
                        <strong>批量作图</strong>
                        <span>一次上传多组素材，批量出图</span>
                    </div>
                }
                featureSwitch={null}
            />
        </div>
    );
}
