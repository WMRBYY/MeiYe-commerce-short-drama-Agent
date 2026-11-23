import { personalAppearanceMessages } from "../../personal-appearance-messages";
import { personalAvatarMessages } from "../../personal-avatar-messages";
// 一种界面语言的完整文案：公共目录 + 各页面区域目录（区域名作为顶级命名空间）。
// 简体中文随首屏打包，其他语言由 i18n/index.ts 按需动态加载。
import { koKR as core } from "../ko-KR";
import { koKR as create } from "../areas/create/ko-KR";
import { koKR as createWorkspace } from "../areas/createWorkspace/ko-KR";
import { koKR as library } from "../areas/library/ko-KR";
import { koKR as account } from "../areas/account/ko-KR";
import { koKR as canvasPage } from "../areas/canvasPage/ko-KR";
import { koKR as canvasA } from "../areas/canvasA/ko-KR";
import { koKR as canvasB } from "../areas/canvasB/ko-KR";
import { koKR as canvasC } from "../areas/canvasC/ko-KR";
import { koKR as drama } from "../areas/drama/ko-KR";
import { koKR as ecommerce } from "../areas/ecommerce/ko-KR";
import { koKR as ecommercePanels } from "../areas/ecommercePanels/ko-KR";
import { koKR as ecommerceVideo } from "../areas/ecommerceVideo/ko-KR";
import { koKR as ecommerceData } from "../areas/ecommerceData/ko-KR";
import { koKR as ecommerceFlow } from "../areas/ecommerceFlow/ko-KR";
import { koKR as home } from "../areas/home/ko-KR";
import { koKR as workspace } from "../areas/workspace/ko-KR";
import { koKR as sharedUi } from "../areas/sharedUi/ko-KR";

export const bundle = {
    ...core,
    personalAppearance: personalAppearanceMessages["ko-KR"],
    personalAvatar: personalAvatarMessages["ko-KR"],
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
