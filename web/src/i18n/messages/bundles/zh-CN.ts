import { personalAppearanceMessages } from "../../personal-appearance-messages";
import { personalAvatarMessages } from "../../personal-avatar-messages";
// 一种界面语言的完整文案：公共目录 + 各页面区域目录（区域名作为顶级命名空间）。
// 简体中文随首屏打包，其他语言由 i18n/index.ts 按需动态加载。
import { zhCN as core } from "../zh-CN";
import { zhCN as create } from "../areas/create/zh-CN";
import { zhCN as createWorkspace } from "../areas/createWorkspace/zh-CN";
import { zhCN as library } from "../areas/library/zh-CN";
import { zhCN as account } from "../areas/account/zh-CN";
import { zhCN as canvasPage } from "../areas/canvasPage/zh-CN";
import { zhCN as canvasA } from "../areas/canvasA/zh-CN";
import { zhCN as canvasB } from "../areas/canvasB/zh-CN";
import { zhCN as canvasC } from "../areas/canvasC/zh-CN";
import { zhCN as drama } from "../areas/drama/zh-CN";
import { zhCN as ecommerce } from "../areas/ecommerce/zh-CN";
import { zhCN as ecommercePanels } from "../areas/ecommercePanels/zh-CN";
import { zhCN as ecommerceVideo } from "../areas/ecommerceVideo/zh-CN";
import { zhCN as ecommerceData } from "../areas/ecommerceData/zh-CN";
import { zhCN as ecommerceFlow } from "../areas/ecommerceFlow/zh-CN";
import { zhCN as home } from "../areas/home/zh-CN";
import { zhCN as workspace } from "../areas/workspace/zh-CN";
import { zhCN as sharedUi } from "../areas/sharedUi/zh-CN";

export const bundle = {
    ...core,
    personalAppearance: personalAppearanceMessages["zh-CN"],
    personalAvatar: personalAvatarMessages["zh-CN"],
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
