import { useNavigate } from "react-router";
import { Button } from "antd";
import type { ReactNode } from "react";

export default function DanceEntry({ kindSwitch, hidden }: { kindSwitch?: ReactNode; hidden?: boolean }) {
    const navigate = useNavigate();
    if (hidden) return null;
    return (
        <section className="flex min-h-64 flex-col items-center justify-center gap-4 p-8">
            {kindSwitch}
            <h2 className="text-lg font-semibold">跳舞复刻</h2>
            <p className="text-sm text-muted-foreground">添加一张角色全身图和一段参考舞蹈视频，选择支持图片与视频参考的模型。</p>
            <Button type="primary" onClick={() => navigate("/create?workflow=dance")}>开始跳舞复刻</Button>
        </section>
    );
}
