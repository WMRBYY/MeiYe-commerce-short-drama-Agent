import { personalAppearanceMessages } from "../../personal-appearance-messages";
import { personalAvatarMessages } from "../../personal-avatar-messages";
// 一种界面语言的完整文案：公共目录 + 各页面区域目录（区域名作为顶级命名空间）。
// 简体中文随首屏打包，其他语言由 i18n/index.ts 按需动态加载。
import { deDE as core } from "../de-DE";
import { deDE as create } from "../areas/create/de-DE";
import { deDE as createWorkspace } from "../areas/createWorkspace/de-DE";
import { deDE as library } from "../areas/library/de-DE";
import { deDE as account } from "../areas/account/de-DE";
import { deDE as canvasPage } from "../areas/canvasPage/de-DE";
import { deDE as canvasA } from "../areas/canvasA/de-DE";
import { deDE as canvasB } from "../areas/canvasB/de-DE";
import { deDE as canvasC } from "../areas/canvasC/de-DE";
import { deDE as drama } from "../areas/drama/de-DE";
import { deDE as ecommerce } from "../areas/ecommerce/de-DE";
import { deDE as ecommercePanels } from "../areas/ecommercePanels/de-DE";
import { deDE as ecommerceVideo } from "../areas/ecommerceVideo/de-DE";
import { deDE as ecommerceData } from "../areas/ecommerceData/de-DE";
import { deDE as ecommerceFlow } from "../areas/ecommerceFlow/de-DE";
import { deDE as home } from "../areas/home/de-DE";
import { deDE as workspace } from "../areas/workspace/de-DE";
import { deDE as sharedUi } from "../areas/sharedUi/de-DE";

export const bundle = {
    ...core,
    personalAppearance: personalAppearanceMessages["de-DE"],
    personalAvatar: personalAvatarMessages["de-DE"],
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
