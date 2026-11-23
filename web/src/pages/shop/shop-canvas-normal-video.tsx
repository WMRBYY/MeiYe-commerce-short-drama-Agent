import { Button } from "antd";
import { SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { canvasNodeMentionToken, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { assertCurrentUserSession, captureUserSession } from "@/lib/user-scope";
import { WorkbenchPage } from "@/pages/workbench/image-workbench-page";
import type { WorkbenchVideoNodeDraft } from "@/pages/workbench/workbench-video-node";
import { ApiError } from "@/services/api/request";
import type { GenerationTask } from "@/services/api/task-center";
import { modelDisplayName, useEffectiveConfig } from "@/stores/use-config-store";
import type { CommerceGraphNode, ShopCanvasReferenceInput } from "./shop-canvas-graph";
import { readShopCanvasVideoSubmission, reconcileShopCanvasVideoInput, saveShopCanvasVideoSubmission, shopCanvasVideoSubmissionId, type ShopCanvasVideoSubmission } from "./shop-canvas-normal-video-state";
import { ShopDropdown } from "./shop-dropdown";
import { ShopCanvasVideoParameters } from "./shop-canvas-video-parameters";
import "./shop-video-generation.css";

type Props = {
    scope: string;
    submissionKey: string;
    draft?: WorkbenchVideoNodeDraft;
    linkSignature?: string;
    prompt?: string;
    references: CommerceGraphNode[];
    canvasReferences?: CanvasResourceReference[];
    onReferenceChange?: (references: ShopCanvasReferenceInput[]) => void;
    failedTaskId?: string;
    runStatus?: string;
    onReuse?: () => void;
    onDraftChange: (draft: WorkbenchVideoNodeDraft, links: string) => void;
    onSubmitted: (taskId: string, draft: WorkbenchVideoNodeDraft) => void;
};

export function ShopCanvasNormalVideo(props: Props) {
    if (props.runStatus) return <ShopCanvasNormalVideoParameters status={props.runStatus} draft={props.draft} onReuse={props.onReuse} />;
    return <ShopCanvasEditableNormalVideo {...props} />;
}

function ShopCanvasNormalVideoParameters({ status, draft, onReuse }: { status: string; draft?: WorkbenchVideoNodeDraft; onReuse?: () => void }) {
    const config = useEffectiveConfig();
    return (
        <ShopCanvasVideoParameters
            status={status}
            prompt={draft?.submittedPrompt || draft?.prompt}
            references={draft?.references}
            items={draft ? [
                ["模型", draft.model ? modelDisplayName(config, draft.model) : undefined],
                ["时长", draft.seconds ? `${draft.seconds} 秒` : undefined],
                ["比例", draft.ratio],
                ["清晰度", /^\d+$/.test(draft.resolution) ? `${draft.resolution}P` : draft.resolution.toUpperCase()],
                ["生成音频", draft.audio ? "开启" : "关闭"],
                ["水印", draft.watermark ? "开启" : "关闭"],
            ] : []}
            onReuse={draft ? onReuse : undefined}
        />
    );
}

function ShopCanvasEditableNormalVideo({ scope, submissionKey, draft, linkSignature, prompt = "", references, canvasReferences, onReferenceChange, failedTaskId, onDraftChange, onSubmitted }: Props) {
    const config = useEffectiveConfig();
    const currentDraft = useRef({ draft: draft || { prompt, model: "", ratio: "", seconds: "", resolution: "", audio: config.videoGenerateAudio === "true", watermark: config.videoWatermark === "true", references: [] }, signature: linkSignature });
    const [submission, setSubmission] = useState<ShopCanvasVideoSubmission | null>();
    const [loadError, setLoadError] = useState("");
    const submitting = useRef(false);
    const [busy, setBusy] = useState(false);
    const latest = useRef({ onDraftChange, onSubmitted, onReferenceChange, canvasReferences });
    latest.current = { onDraftChange, onSubmitted, onReferenceChange, canvasReferences };
    const projectedReferences = useRef<string | undefined>(undefined);
    const editorKey = useRef(linkSignature);
    useEffect(() => {
        let alive = true;
        void readShopCanvasVideoSubmission(scope, submissionKey)
            .then((value) => {
                if (!alive) return;
                setSubmission(value);
                if (value?.taskId && value.taskId !== failedTaskId) latest.current.onSubmitted(value.taskId, value.draft);
            })
            .catch(() => {
                if (alive) setLoadError("读取视频提交记录失败，请关闭面板后重试");
            });
        return () => {
            alive = false;
        };
    }, [scope, submissionKey, failedTaskId]);

    const pending = Boolean(submission && !submission.taskId);
    const initial = pending && submission ? { draft: submission.draft, signature: "pending" } : reconcileShopCanvasVideoInput(currentDraft.current.draft, currentDraft.current.signature, references);
    if (initial.signature !== currentDraft.current.signature && JSON.stringify(initial.draft) !== JSON.stringify(currentDraft.current.draft)) editorKey.current = initial.signature;
    const captureDraft = useCallback(
        (next: WorkbenchVideoNodeDraft) => {
            if (initial.signature !== currentDraft.current.signature || JSON.stringify(next) !== JSON.stringify(currentDraft.current.draft)) {
                currentDraft.current = { draft: next, signature: initial.signature };
                latest.current.onDraftChange(next, initial.signature);
            }
            const ready: ShopCanvasReferenceInput[] = next.references.map(({ id, resourceId, kind, name }) => ({
                nodeId: id.startsWith("canvas-ref:") ? id.slice("canvas-ref:".length) : undefined,
                resourceId,
                kind,
                name,
            }));
            for (const reference of latest.current.canvasReferences || []) {
                if (reference.kind === "text" && next.prompt.includes(canvasNodeMentionToken(reference.nodeId))) ready.push({ nodeId: reference.nodeId, kind: "text", name: reference.title });
            }
            const signature = JSON.stringify(ready);
            if (projectedReferences.current !== signature) {
                projectedReferences.current = signature;
                latest.current.onReferenceChange?.(ready);
            }
        },
        [initial.signature],
    );

    const submit = async (next: WorkbenchVideoNodeDraft, create: (id: string) => Promise<GenerationTask>) => {
        if (submitting.current) return;
        const session = captureUserSession(true);
        submitting.current = true;
        setBusy(true);
        const perform = async () => {
            const previous = await readShopCanvasVideoSubmission(scope, submissionKey);
            assertCurrentUserSession(session, true);
            if (previous?.taskId && previous.taskId !== failedTaskId) {
                latest.current.onSubmitted(previous.taskId, previous.draft);
                return;
            }
            if (previous && !previous.taskId && JSON.stringify(previous.draft) !== JSON.stringify(next)) {
                setSubmission(previous);
                throw new Error("已有待确认的视频提交，请确认原任务");
            }
            const attempt = previous && !previous.taskId ? previous : { id: await shopCanvasVideoSubmissionId(submissionKey, previous?.taskId), draft: next };
            assertCurrentUserSession(session, true);
            await saveShopCanvasVideoSubmission(scope, submissionKey, attempt);
            assertCurrentUserSession(session, true);
            setSubmission(attempt);
            let task: GenerationTask;
            try {
                task = await create(attempt.id);
            } catch (error) {
                assertCurrentUserSession(session, true);
                if ((!previous || previous.taskId) && error instanceof ApiError && !error.retryable && error.status && [400, 401, 403, 402, 422].includes(error.status)) {
                    await saveShopCanvasVideoSubmission(scope, submissionKey, previous);
                    setSubmission(previous);
                }
                throw error;
            }
            assertCurrentUserSession(session, true);
            try {
                await saveShopCanvasVideoSubmission(scope, submissionKey, { ...attempt, taskId: task.id });
            } finally {
                assertCurrentUserSession(session, true);
                latest.current.onSubmitted(task.id, attempt.draft);
            }
        };
        try {
            if (navigator.locks) await navigator.locks.request(`canvas-video-submit:${scope}:${submissionKey}`, perform);
            else await perform();
        } finally {
            submitting.current = false;
            setBusy(false);
        }
    };

    if (loadError)
        return (
            <p className="sp-canvas-video-message" role="alert">
                {loadError}
            </p>
        );
    if (submission === undefined || (submission?.taskId && submission.taskId !== failedTaskId))
        return (
            <p className="sp-canvas-video-message" role="status">
                正在读取视频节点…
            </p>
        );
    return (
        <WorkbenchPage
            key={pending ? "pending" : editorKey.current}
            kind="video"
            canvasVideo={{ draft: initial.draft, pending, canvasReferences, onDraftChange: captureDraft, onSubmit: submit }}
            renderComposer={({ inputs, settings, footer, modelLabel, specLabel, onPaste, onSubmit }) =>
                pending ? (
                    <div className="sp-canvas-video-message">
                        <p role="status">正在确认上次提交。可继续读取原任务，操作不会重复创建视频。</p>
                        <Button onClick={onSubmit} loading={busy}>
                            确认提交状态
                        </Button>
                    </div>
                ) : (
                    <div className="sp-canvas-video-content" data-canvas-wheel-scroll onPasteCapture={onPaste}>
                        <div className="sp-canvas-video-inputs">{inputs}</div>
                        <div className="svg-toolbar">
                            <div className="svg-controls">
                                <ShopDropdown
                                    placement="top"
                                    width={320}
                                    ariaLabel="视频模型与参数"
                                    icon={<SlidersHorizontal className="size-3.5" />}
                                    label={
                                        <>
                                            <span className="svg-model-label">{modelLabel}</span>
                                            <span className="svg-spec-label">{specLabel}</span>
                                        </>
                                    }
                                >
                                    {() => (
                                        <div className="svg-settings wb-shell sp-canvas-video-settings ms-scope" data-canvas-no-zoom data-canvas-wheel-scroll>
                                            {settings}
                                        </div>
                                    )}
                                </ShopDropdown>
                            </div>
                            {footer}
                        </div>
                    </div>
                )
            }
        />
    );
}
