import { App, Button, Input } from "antd";
import { CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

import { UserAvatar } from "@/components/layout/user-avatar";
import { getAuthSettings, getWeChatBindingStatus, startWeChatBind } from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";

export function WeChatAccountPane() {
    const { message } = App.useApp();
    const user = useUserStore((state) => state.user);
    const [searchParams, setSearchParams] = useSearchParams();
    const [justBound] = useState(() => searchParams.get("wechat_bound") === "1");
    const [available, setAvailable] = useState(false);
    const [bound, setBound] = useState(false);
    const [loading, setLoading] = useState(true);
    const [statusError, setStatusError] = useState(false);
    const [starting, setStarting] = useState(false);
    const [password, setPassword] = useState("");

    useEffect(() => {
        let active = true;
        void Promise.allSettled([getAuthSettings(), getWeChatBindingStatus()])
            .then(([settings, status]) => {
                if (!active) return;
                if (settings.status === "fulfilled") setAvailable(settings.value.wechatAvailable);
                if (status.status === "fulfilled") setBound(status.value.bound);
                if (settings.status === "rejected" || status.status === "rejected") {
                    setStatusError(true);
                    message.error("读取微信绑定状态失败");
                }
            })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [message]);

    useEffect(() => {
        if (!bound || !searchParams.has("wechat_bound")) return;
        const next = new URLSearchParams(searchParams);
        next.delete("wechat_bound");
        setSearchParams(next, { replace: true });
    }, [bound, searchParams, setSearchParams]);

    const bind = async () => {
        if (!available || bound || starting) return;
        setStarting(true);
        try {
            const result = await startWeChatBind(password);
            setPassword("");
            window.location.assign(result.url);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "微信绑定发起失败");
            setStarting(false);
        }
    };

    return (
        <section className="settings-section" aria-labelledby="wechat-account-title">
            <div className="settings-preference-heading">
                <h2 id="wechat-account-title">微信账号</h2>
                <p>仅在你主动发起并扫码确认后绑定到当前账号，不会根据昵称或头像合并账号。</p>
            </div>
            {bound ? (
                <div role="status" className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 p-4">
                    {user ? <UserAvatar user={user} className="size-12 rounded-full" /> : null}
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 font-medium">
                            <CheckCircle2 className="size-4 text-green-600" aria-hidden />
                            <span>{justBound ? "微信绑定成功" : "微信已绑定"}</span>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{user?.displayName || "当前账号"} · 可使用微信扫码登录</p>
                        {!user?.avatarUrl ? <p className="mt-1 text-sm text-muted-foreground">微信头像暂未获取，使用微信登录后会再次尝试同步。</p> : null}
                    </div>
                    <span className="shrink-0 text-sm text-muted-foreground">已绑定</span>
                </div>
            ) : (
                <p role="status" className="text-sm text-muted-foreground">
                    {loading ? "正在读取绑定状态…" : statusError ? "读取微信绑定状态失败，请刷新页面重试" : available ? "当前账号尚未绑定微信" : "微信扫码登录尚未启用"}
                </p>
            )}
            {user?.role === "admin" && !loading && !statusError && !bound && available ? (
                <Input.Password value={password} onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password" placeholder="管理员绑定前请再次输入当前密码" aria-label="管理员当前密码" />
            ) : null}
            {!loading && !statusError && !bound && available ? (
                <>
                    <p className="text-sm text-muted-foreground">请先重新登录，再在 5 分钟内点击绑定。手机号用户须先完成手机号验证。</p>
                    <Button disabled={starting || (user?.role === "admin" && !password)} loading={starting} onClick={() => void bind()}>
                        绑定微信账号
                    </Button>
                </>
            ) : null}
        </section>
    );
}
