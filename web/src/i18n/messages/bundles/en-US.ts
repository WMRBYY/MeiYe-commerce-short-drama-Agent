import { personalAppearanceMessages } from "../../personal-appearance-messages";
import { personalAvatarMessages } from "../../personal-avatar-messages";
// 一种界面语言的完整文案：公共目录 + 各页面区域目录（区域名作为顶级命名空间）。
// 简体中文随首屏打包，其他语言由 i18n/index.ts 按需动态加载。
import { enUS as core } from "../en-US";
import { enUS as create } from "../areas/create/en-US";
import { enUS as createWorkspace } from "../areas/createWorkspace/en-US";
import { enUS as library } from "../areas/library/en-US";
import { enUS as account } from "../areas/account/en-US";
import { enUS as canvasPage } from "../areas/canvasPage/en-US";
import { enUS as canvasA } from "../areas/canvasA/en-US";
import { enUS as canvasB } from "../areas/canvasB/en-US";
import { enUS as canvasC } from "../areas/canvasC/en-US";
import { enUS as drama } from "../areas/drama/en-US";
import { enUS as ecommerce } from "../areas/ecommerce/en-US";
import { enUS as ecommercePanels } from "../areas/ecommercePanels/en-US";
import { enUS as ecommerceVideo } from "../areas/ecommerceVideo/en-US";
import { enUS as ecommerceData } from "../areas/ecommerceData/en-US";
import { enUS as ecommerceFlow } from "../areas/ecommerceFlow/en-US";
import { enUS as home } from "../areas/home/en-US";
import { enUS as workspace } from "../areas/workspace/en-US";
import { enUS as sharedUi } from "../areas/sharedUi/en-US";

export const bundle = {
    ...core,
    personalAppearance: personalAppearanceMessages["en-US"],
    personalAvatar: personalAvatarMessages["en-US"],
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
