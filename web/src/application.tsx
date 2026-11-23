import React from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import "./styles/globals.css";
import "./styles/shared/model-picker.css";
import "./styles/shared/overlays.css";
import "./styles/shared/scrollbars.css";
import "./styles/meiye-unified.css";
import "@/themes/load";
import { RouterProvider } from "react-router";

import { AppProviders } from "@/components/layout/app-providers";
import { router } from "@/router";
import { installSiteTrafficCollector } from "@/services/site-traffic";

document.body.style.fontFamily = '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif';

createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <AppProviders>
            {/*
              不把路由更新包进 React 过渡：否则点到还没下载代码的页面时，整个界面（包括左侧导航高亮）会停在旧页面，
              直到代码下载完才变，看起来像「点了没反应」。关掉后地址一变立刻切换，内容区先显示加载动画。
            */}
            <RouterProvider router={router} useTransitions={false} />
        </AppProviders>
    </React.StrictMode>,
);

// 在 React 生命周期外安装，游客与 StrictMode 都共用一次路由订阅。
const disposeTraffic = installSiteTrafficCollector(router);
if (import.meta.hot) import.meta.hot.dispose(disposeTraffic);
