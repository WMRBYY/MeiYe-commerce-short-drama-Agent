import { personalAppearanceMessages } from "../../personal-appearance-messages";
import { personalAvatarMessages } from "../../personal-avatar-messages";
// 一种界面语言的完整文案：公共目录 + 各页面区域目录（区域名作为顶级命名空间）。
// 简体中文随首屏打包，其他语言由 i18n/index.ts 按需动态加载。
import { frFR as core } from "../fr-FR";
import { frFR as create } from "../areas/create/fr-FR";
import { frFR as createWorkspace } from "../areas/createWorkspace/fr-FR";
import { frFR as library } from "../areas/library/fr-FR";
import { frFR as account } from "../areas/account/fr-FR";
import { frFR as canvasPage } from "../areas/canvasPage/fr-FR";
import { frFR as canvasA } from "../areas/canvasA/fr-FR";
import { frFR as canvasB } from "../areas/canvasB/fr-FR";
import { frFR as canvasC } from "../areas/canvasC/fr-FR";
import { frFR as drama } from "../areas/drama/fr-FR";
import { frFR as ecommerce } from "../areas/ecommerce/fr-FR";
import { frFR as ecommercePanels } from "../areas/ecommercePanels/fr-FR";
import { frFR as ecommerceVideo } from "../areas/ecommerceVideo/fr-FR";
import { frFR as ecommerceData } from "../areas/ecommerceData/fr-FR";
import { frFR as ecommerceFlow } from "../areas/ecommerceFlow/fr-FR";
import { frFR as home } from "../areas/home/fr-FR";
import { frFR as workspace } from "../areas/workspace/fr-FR";
import { frFR as sharedUi } from "../areas/sharedUi/fr-FR";

export const bundle = {
    ...core,
    personalAppearance: personalAppearanceMessages["fr-FR"],
    personalAvatar: personalAvatarMessages["fr-FR"],
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
