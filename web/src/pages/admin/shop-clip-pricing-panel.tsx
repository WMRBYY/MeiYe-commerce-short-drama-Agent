import { useEffect, useRef, useState } from "react";
import { Alert, App, Button, InputNumber, Spin } from "antd";
import { getClipPricing, updateClipPricing, type ClipPricing } from "@/services/api/clip-pricing";

export default function ShopClipPricingPanel({ refresh }: { refresh: number }) {
    const { message } = App.useApp();
    const [data, setData] = useState<ClipPricing>();
    const [credits, setCredits] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [reload, setReload] = useState(0);
    const savingRef = useRef(false);

    useEffect(() => {
        if (savingRef.current) return;
        let active = true;
        setLoading(true);
        void getClipPricing()
            .then((next) => {
                if (!active) return;
                setData(next);
                setCredits(next.creditsPerClip);
                setError("");
            })
            .catch((cause: unknown) => {
                if (active) setError(cause instanceof Error ? cause.message : "计费配置读取失败，请重试");
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [refresh, reload]);

    const invalid = credits === null || !Number.isSafeInteger(credits) || credits < 0 || credits > (data?.maxCredits ?? 100000);
    const save = async () => {
        if (loading || savingRef.current || invalid || credits === null) return;
        savingRef.current = true;
        setSaving(true);
        setError("");
        try {
            const next = await updateClipPricing(credits);
            setData(next);
            setCredits(next.creditsPerClip);
            void message.success("剪辑价格已保存，新提交的项目按此计费");
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "价格保存失败，请重试");
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };

    return (
        <section className="clip-pricing-panel" aria-labelledby="clip-pricing-title">
            <div className="clip-pricing-heading">
                <div>
                    <h2 id="clip-pricing-title">每条成片固定积分</h2>
                    <p>网感剪辑、智能混剪和字幕剪辑使用同一价格。</p>
                </div>
                {loading ? <Spin size="small" /> : <span className="clip-kb-muted">{data?.configured ? "已保存配置" : data ? "默认价格" : "尚未读取"}</span>}
            </div>
            {error ? (
                <Alert
                    type="error"
                    showIcon
                    message={error}
                    action={
                        <Button size="small" disabled={saving} onClick={() => setReload((value) => value + 1)}>
                            重新读取
                        </Button>
                    }
                />
            ) : null}
            <div className="clip-pricing-field">
                <label htmlFor="clip-pricing-credits">每条剪辑</label>
                <div>
                    <InputNumber
                        id="clip-pricing-credits"
                        aria-label="每条剪辑积分"
                        min={0}
                        max={data?.maxCredits ?? 100000}
                        precision={0}
                        step={1}
                        value={credits}
                        onChange={setCredits}
                        disabled={loading || saving || !data}
                        status={!loading && data && invalid ? "error" : undefined}
                    />
                    <span>积分</span>
                </div>
                <p>{data ? `默认 ${data.defaultCredits} 积分；填写 0 则免积分。` : "读取配置后可调整价格。"}</p>
                {!loading && data && invalid ? (
                    <p className="clip-pricing-field-error" role="alert">
                        请输入 0 至 {data.maxCredits} 的整数
                    </p>
                ) : null}
            </div>
            <ol className="clip-pricing-flow">
                <li>
                    <strong>提交时预扣</strong>
                    <span>按提交时的价格预扣积分，余额不足时不创建收费任务。</span>
                </li>
                <li>
                    <strong>成片后结算</strong>
                    <span>成片成功后结算已预扣积分，不重复扣费。</span>
                </li>
                <li>
                    <strong>失败或取消退还</strong>
                    <span>任务失败或取消后退还已预扣积分。</span>
                </li>
            </ol>
            <div className="clip-pricing-footer">
                <p>先分析并校对不扣费，确认生成时再预扣。修改只对新提交生效；进行中的项目保留提交价，旧任务不追溯收费。</p>
                <Button type="primary" loading={saving} disabled={loading || !data || invalid || credits === data.creditsPerClip} onClick={() => void save()}>
                    保存价格
                </Button>
            </div>
        </section>
    );
}
