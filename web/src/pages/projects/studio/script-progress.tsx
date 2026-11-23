import { useEffect, useRef, useState } from "react";
import { Button } from "antd";

import { isGenerationTaskTerminalError, waitForGenerationTask, type GenerationTask } from "@/services/api/task-center";
import type { DramaJob } from "@/services/api/drama";
import { JobDetailModal } from "./job-detail";

/** 只监听已创建任务；离开页面停止监听，保留后台制作。 */
export function ScriptProgress({ projectId, job, onComplete }: { projectId: string; job: DramaJob; onComplete: () => void }) {
    const [task, setTask] = useState<GenerationTask>();
    const [characters, setCharacters] = useState(0);
    const [connectionError, setConnectionError] = useState(false);
    const [retry, setRetry] = useState(0);
    const [detailOpen, setDetailOpen] = useState(false);
    const onCompleteRef = useRef(onComplete);
    onCompleteRef.current = onComplete;

    useEffect(() => {
        setTask(undefined);
        setCharacters(0);
        setConnectionError(false);
        if (!job.taskId || job.status !== "running") return;
        const controller = new AbortController();
        void waitForGenerationTask(job.taskId, {
            signal: controller.signal,
            useTextEvents: true,
            onTextDelta: (text) => setCharacters(Array.from(text).length),
            onTaskUpdate: setTask,
        }).then(() => {
            if (!controller.signal.aborted) onCompleteRef.current();
        }).catch((error) => {
            if (controller.signal.aborted) return;
            if (isGenerationTaskTerminalError(error)) setTask(error.task);
            else setConnectionError(true);
            onCompleteRef.current();
        });
        return () => controller.abort();
    }, [job.taskId, job.status, retry]);

    const failed = task?.status === "failed" || task?.status === "cancelled";
    const done = task?.status === "succeeded";
    const text = failed ? "本次生成未完成，请查看详情。"
        : done ? "模型已返回结果，正在整理并推进下一步。"
        : connectionError ? "进度连接暂时中断，可重新连接查看。"
        : characters > 0 ? `模型正在返回内容 · 已收到 ${characters.toLocaleString("zh-CN")} 字`
        : !job.taskId || task?.status === "queued" ? "已加入制作队列，等待可用生成名额。"
        : "任务已开始处理，正在等待模型返回内容。";

    return (
        <div className="flex flex-col items-center gap-3">
            <p role="status" aria-live="polite">{text}</p>
            <div className="flex gap-2">
                {connectionError && !failed ? <Button onClick={() => setRetry((value) => value + 1)}>重新连接进度</Button> : null}
                <Button onClick={() => setDetailOpen(true)}>查看生成详情</Button>
            </div>
            <JobDetailModal projectId={projectId} job={detailOpen ? job : undefined} onClose={() => setDetailOpen(false)} onLocate={() => undefined} />
        </div>
    );
}
