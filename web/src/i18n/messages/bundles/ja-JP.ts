import { personalAppearanceMessages } from "../../personal-appearance-messages";
import { personalAvatarMessages } from "../../personal-avatar-messages";
// 一种界面语言的完整文案：公共目录 + 各页面区域目录（区域名作为顶级命名空间）。
// 简体中文随首屏打包，其他语言由 i18n/index.ts 按需动态加载。
import { jaJP as core } from "../ja-JP";
import { jaJP as create } from "../areas/create/ja-JP";
import { jaJP as createWorkspace } from "../areas/createWorkspace/ja-JP";
import { jaJP as library } from "../areas/library/ja-JP";
import { jaJP as account } from "../areas/account/ja-JP";
import { jaJP as canvasPage } from "../areas/canvasPage/ja-JP";
import { jaJP as canvasA } from "../areas/canvasA/ja-JP";
import { jaJP as canvasB } from "../areas/canvasB/ja-JP";
import { jaJP as canvasC } from "../areas/canvasC/ja-JP";
import { jaJP as drama } from "../areas/drama/ja-JP";
import { jaJP as ecommerce } from "../areas/ecommerce/ja-JP";
import { jaJP as ecommercePanels } from "../areas/ecommercePanels/ja-JP";
import { jaJP as ecommerceVideo } from "../areas/ecommerceVideo/ja-JP";
import { jaJP as ecommerceData } from "../areas/ecommerceData/ja-JP";
import { jaJP as ecommerceFlow } from "../areas/ecommerceFlow/ja-JP";
import { jaJP as home } from "../areas/home/ja-JP";
import { jaJP as workspace } from "../areas/workspace/ja-JP";
import { jaJP as sharedUi } from "../areas/sharedUi/ja-JP";

export const bundle = {
    ...core,
    personalAppearance: personalAppearanceMessages["ja-JP"],
    personalAvatar: personalAvatarMessages["ja-JP"],
    create,
    createWorkspace,
    library,
    account,
    canvasPage,
    canvasA,
    canvasB,
    canvasC,
    drama,
    ecommerce,
    ecommercePanels,
    ecommerceVideo,
    ecommerceData,
    ecommerceFlow,
    home,
    workspace,
    sharedUi,
};
