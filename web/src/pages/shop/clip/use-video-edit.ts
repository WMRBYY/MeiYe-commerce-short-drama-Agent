import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClientUUID } from "@/lib/client-id";
import { ApiError } from "@/services/api/request";
import { getResource, resourceFileUrl, uploadResourceFile } from "@/services/api/resources";
import {
    cancelClip,
    createClip,
    getClip,
    getClipCapabilities,
    listClips,
    quoteClip,
    renderClip,
    retryClip,
    saveClipPlan,
    type ClipCapabilities,
    type ClipMode,
    type ClipPlan,
    type ClipProject,
    type ClipQuote,
    type CreateClipInput,
    type ShopClipVisual,
} from "@/services/api/video-edit";
import { clipPlanError, clipRunning, clipTitleError, clipTrimError, inspectClipVideo, inspectClipVideoUrl, validSubjectBox } from "./clip-model";
import { emptyCaptionHistory, moveCaptionHistory, recordCaptionEdit } from "./clip-captions";

export type ClipMedia = { resourceId: string; name: string; durationMs?: number; width?: number; height?: number };
const errorText = (error: unknown) => (error instanceof Error ? error.message : "请求未完成，请重新尝试。");

export function useVideoEdit(scope: string) {
    const storageKey = `meiye.shop.clip.selected.${scope}`;
    const [mode, setMode] = useState<ClipMode>("koubo");
    const [source, setSource] = useState<ClipMedia | null>(null);
    const [materials, setMaterials] = useState<ClipMedia[]>([]);
    const [music, setMusic] = useState<ClipMedia | null>(null);
    const [musicVolume, setMusicVolume] = useState(0.15);
    const [title, setTitle] = useState("");
    const [templateId, setTemplateId] = useState("clean");
    const [visual, setVisual] = useState<ShopClipVisual>();
    const [referenceText, setReferenceText] = useState("");
    const [reviewBeforeRender, setReviewBeforeRender] = useState(false);
    const [trimStartMs, setTrimStartMs] = useState(0);
    const [trimEndMs, setTrimEndMs] = useState(0);
    const [quoted, setQuoted] = useState<{ key: string; value: ClipQuote } | null>(null);
    const [quoteRevision, setQuoteRevision] = useState(0);
    const [quoteError, setQuoteError] = useState("");
    const [quoting, setQuoting] = useState(false);
    const [behindText, setBehindText] = useState("");
    const [behindPosition, setBehindPosition] = useState<ClipPlan["behindPosition"]>("center");
    const [subjectBox, setSubjectBox] = useState<number[]>();
    const [capabilities, setCapabilities] = useState<ClipCapabilities | null>(null);
    const [capabilityError, setCapabilityError] = useState("");
    const [projects, setProjects] = useState<ClipProject[]>([]);
    const [selectedId, setSelectedId] = useState(() => {
        try {
            return window.localStorage.getItem(storageKey) || "";
        } catch {
            return "";
        }
    });
    const [plan, setPlan] = useState<ClipPlan | null>(null);
    const [captionHistory, setCaptionHistory] = useState(emptyCaptionHistory);
    const [editorRevision, setEditorRevision] = useState(0);
    const [dirty, setDirty] = useState(false);
    const [error, setError] = useState("");
    const [historyError, setHistoryError] = useState("");
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [upload, setUpload] = useState<{ name: string; progress: number } | null>(null);
    const mounted = useRef(true);
    const actionGuard = useRef(false);
    const uploadController = useRef<AbortController | null>(null);
    const requestKeys = useRef(new Map<string, string>());
    const projectStatuses = useRef(new Map<string, ClipProject["status"]>());
    const selected = projects.find((item) => item.id === selectedId) || null;
    const blocked = busy || Boolean(upload) || clipRunning(selected);

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            uploadController.current?.abort();
        };
    }, []);
    useEffect(() => {
        try {
            if (selectedId) window.localStorage.setItem(storageKey, selectedId);
            else window.localStorage.removeItem(storageKey);
        } catch {
            /* 仅影响下次打开时的选择。 */
        }
    }, [selectedId, storageKey]);

    const upsert = useCallback((project: ClipProject) => {
        projectStatuses.current.set(project.id, project.status);
        if (mounted.current) setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)]);
    }, []);
    const restore = useCallback((project: ClipProject) => {
        setSelectedId(project.id);
        setMode(project.mode);
        setPlan(project.plan);
        setCaptionHistory(emptyCaptionHistory());
        setEditorRevision((value) => value + 1);
        setDirty(false);
        setError("");
        setSource(project.plan?.sourceResourceId ? { resourceId: project.plan.sourceResourceId, name: "原视频", durationMs: project.plan.sourceDurationMs || project.plan.durationMs, width: project.plan.width, height: project.plan.height } : null);
        setMaterials((project.plan?.materials || []).map((resourceId, index) => ({ resourceId, name: `画面素材 ${index + 1}` })));
        setTitle(project.plan?.title || project.title || "");
        setTemplateId(project.plan?.templateId || "clean");
        setVisual(project.plan?.visual);
        setReferenceText(project.plan?.referenceText || "");
        setReviewBeforeRender(project.plan?.autoRender === false);
        setTrimStartMs(project.plan?.trimStartMs || 0);
        setTrimEndMs(project.plan?.trimEndMs || 0);
        setBehindText(project.plan?.behindText || "");
        setBehindPosition(project.plan?.behindPosition || "center");
        setSubjectBox(project.plan?.subjectBox);
        setMusic(project.plan?.musicResourceId ? { resourceId: project.plan.musicResourceId, name: "背景音乐" } : null);
        setMusicVolume(project.plan?.musicVolume ?? 0.15);
    }, []);
    const refresh = useCallback(async (signal?: AbortSignal) => {
        try {
            const result = await listClips(signal);
            if (mounted.current && !signal?.aborted) {
                const changedBilling = result.items.some((project) => {
                    const previous = projectStatuses.current.get(project.id);
                    return (previous === "analyzing" || previous === "rendering") && previous !== project.status && ["ready", "succeeded", "failed", "cancelled"].includes(project.status);
                });
                projectStatuses.current = new Map(result.items.map((project) => [project.id, project.status]));
                if (changedBilling) window.dispatchEvent(new CustomEvent("wallet:updated"));
                setProjects(result.items);
                setHistoryError("");
            }
        } catch (e) {
            if (mounted.current && !signal?.aborted) setHistoryError(`历史读取未完成：${errorText(e)}`);
        } finally {
            if (mounted.current && !signal?.aborted) setLoading(false);
        }
    }, []);
    const refreshCapabilities = useCallback(async (signal?: AbortSignal) => {
        try {
            const result = await getClipCapabilities(signal);
            if (mounted.current && !signal?.aborted) {
                setCapabilities(result);
                setCapabilityError("");
            }
        } catch (e) {
            if (mounted.current && !signal?.aborted) {
                setCapabilities(null);
                setCapabilityError(`功能状态读取未完成：${errorText(e)}`);
            }
        }
    }, []);
    useEffect(() => {
        const controller = new AbortController();
        void refresh(controller.signal);
        void refreshCapabilities(controller.signal);
        if (selectedId)
            void getClip(selectedId, controller.signal)
                .then((project) => {
                    if (!controller.signal.aborted) {
                        upsert(project);
                        restore(project);
                    }
                })
                .catch(() => {
                    /* 历史列表保留恢复入口。 */
                });
        return () => controller.abort();
        // 初次进入恢复服务器项目，随后选择由用户操作。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refresh, refreshCapabilities, restore, upsert]);
    const active = projects.some(clipRunning);
    useEffect(() => {
        if (!active) return;
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout>;
        const poll = async () => {
            await refresh(controller.signal);
            if (!controller.signal.aborted) timer = setTimeout(poll, 2500);
        };
        timer = setTimeout(poll, 2500);
        return () => {
            controller.abort();
            clearTimeout(timer);
        };
    }, [active, refresh]);
    const previousStatus = useRef<string | undefined>(undefined);
    useEffect(() => {
        const signature = `${selected?.id}:${selected?.status}`;
        if (selected && selected.status === "ready" && previousStatus.current !== signature) {
            setPlan(selected.plan);
            setCaptionHistory(emptyCaptionHistory());
            setEditorRevision((value) => value + 1);
            setDirty(false);
        }
        previousStatus.current = signature;
    }, [selected]);

    const keyFor = (request: string) => {
        let key = requestKeys.current.get(request);
        if (!key) {
            key = createClientUUID();
            requestKeys.current.set(request, key);
        }
        return key;
    };
    const perform = async (operation: () => Promise<ClipProject>, updateSelection = true) => {
        if (actionGuard.current) return false;
        actionGuard.current = true;
        setBusy(true);
        setError("");
        try {
            const project = await operation();
            if (mounted.current) {
                upsert(project);
                if (updateSelection) restore(project);
            }
            return true;
        } catch (e) {
            if (mounted.current) {
                if (e instanceof ApiError && e.reason === "shop_clip_price_changed") {
                    setQuoted(null);
                    setQuoteRevision((value) => value + 1);
                    setError("剪辑价格已更新，请确认最新积分后再次提交。");
                } else setError(errorText(e));
            }
            return false;
        } finally {
            actionGuard.current = false;
            if (mounted.current) setBusy(false);
        }
    };
    const chooseMode = (next: ClipMode) => {
        if (blocked || next === mode) return;
        setMode(next);
        const supported = capabilities?.templates.find((item) => item.id === templateId && (!item.modes?.length || item.modes.includes(next)));
        if (next === "behind") {
            setTemplateId("clean");
            setVisual(undefined);
        } else if (!supported) {
            const first = capabilities?.templates.find((item) => !item.modes?.length || item.modes.includes(next));
            setTemplateId(first?.id || "clean");
            setVisual(first?.visual);
        } else if (next !== "mix" && visual) setVisual({ ...visual, transition: "cut", layout: "full" });
        setSelectedId("");
        setPlan(null);
        setDirty(false);
        setError("");
    };
    const startNew = () => {
        if (busy || upload) return;
        setSelectedId("");
        setPlan(null);
        setSource(null);
        setMaterials([]);
        setMusic(null);
        setTitle("");
        setReferenceText("");
        setTrimStartMs(0);
        setTrimEndMs(0);
        setBehindText("");
        setSubjectBox(undefined);
        setDirty(false);
        setError("");
        requestKeys.current.clear();
    };
    const uploadFiles = async (files: File[], material = false) => {
        if (blocked || uploadController.current || !files.length) return;
        if (material && materials.length + files.length > 8) {
            setError("最多添加 8 段空镜素材，请减少选择。 ");
            return;
        }
        const controller = new AbortController();
        uploadController.current = controller;
        setError("");
        try {
            for (const file of material ? files : files.slice(0, 1)) {
                setUpload({ name: file.name, progress: 0 });
                const meta = await inspectClipVideo(file, controller.signal);
                if (meta.durationMs > 300000) throw new Error("单段视频不能超过 5 分钟，请先裁短后上传。");
                const resource = await uploadResourceFile(file, "video", { ...meta, fileName: file.name, signal: controller.signal }, (done, total) => {
                    if (mounted.current && !controller.signal.aborted) setUpload({ name: file.name, progress: total ? Math.round((done / total) * 100) : 0 });
                });
                if (!resource.id || resource.kind !== "video" || resource.status !== "ready") throw new Error("视频尚未上传成功，请重试上传。");
                if (controller.signal.aborted || !mounted.current) return;
                const item = { resourceId: resource.id, name: file.name, ...meta };
                if (material) setMaterials((current) => [...current, item]);
                else {
                    setSource(item);
                    setSubjectBox(undefined);
                    setTrimStartMs(0);
                    setTrimEndMs(0);
                }
                setSelectedId("");
                setPlan(null);
                setDirty(false);
            }
        } catch (e) {
            if (mounted.current && !controller.signal.aborted) setError(`上传未完成：${errorText(e)}`);
        } finally {
            uploadController.current = null;
            if (mounted.current) setUpload(null);
        }
    };
    const pickMedia = async (items: Array<{ resourceId: string; name: string }>, material = false) => {
        if (blocked || selected || uploadController.current || !items.length) return;
        const picks = material ? items : items.slice(0, 1);
        if (material && picks.length > 8) {
            setError("最多添加 8 段空镜素材。");
            return;
        }
        const controller = new AbortController();
        uploadController.current = controller;
        setUpload({ name: "正在读取素材信息", progress: 0 });
        setError("");
        try {
            const media = await Promise.all(
                picks.map(async (item) => {
                    const resource = await getResource(item.resourceId);
                    if (resource.kind !== "video" || resource.status !== "ready") throw new Error("请选择已上传完成的视频。");
                    if (resource.size > 512 * 1024 * 1024) throw new Error("单个视频不能超过 512 MB。");
                    const meta = resource.durationMs && resource.width && resource.height ? { durationMs: resource.durationMs, width: resource.width, height: resource.height } : await inspectClipVideoUrl(resourceFileUrl(resource.id), controller.signal);
                    if (meta.durationMs > 300000) throw new Error("单段视频不能超过 5 分钟，请先裁短后上传。");
                    return { ...item, ...meta };
                }),
            );
            if (!mounted.current || controller.signal.aborted) return;
            if (material) setMaterials(media);
            else {
                setSource(media[0]);
                setSubjectBox(undefined);
                setTrimStartMs(0);
                setTrimEndMs(0);
            }
            setPlan(null);
            setDirty(false);
        } catch (e) {
            if (mounted.current && !controller.signal.aborted) setError(`素材选择未完成：${errorText(e)}`);
        } finally {
            uploadController.current = null;
            if (mounted.current) setUpload(null);
        }
    };
    const uploadMusic = async (file?: File) => {
        if (!file || blocked || selected || uploadController.current) return;
        if (!file.type.startsWith("audio/") || !file.size || file.size > 512 * 1024 * 1024) {
            setError("请选择不超过 512 MB 的音频文件。");
            return;
        }
        const controller = new AbortController();
        uploadController.current = controller;
        setUpload({ name: file.name, progress: 0 });
        setError("");
        try {
            const resource = await uploadResourceFile(file, "audio", { fileName: file.name, signal: controller.signal }, (done, total) => {
                if (mounted.current && !controller.signal.aborted) setUpload({ name: file.name, progress: total ? Math.round((done / total) * 100) : 0 });
            });
            if (!resource.id || resource.kind !== "audio" || resource.status !== "ready") throw new Error("音频尚未上传成功，请重试上传。");
            if (mounted.current && !controller.signal.aborted) {
                setMusic({ resourceId: resource.id, name: file.name });
                setDirty(true);
            }
        } catch (e) {
            if (mounted.current && !controller.signal.aborted) setError(`音乐上传未完成：${errorText(e)}`);
        } finally {
            uploadController.current = null;
            if (mounted.current) setUpload(null);
        }
    };
    const capabilityReason = (targetMode: ClipMode, stage: "analyze" | "render" | "auto") => {
        if (capabilityError) return capabilityError;
        if (!capabilities) return "正在读取功能状态…";
        const capability = (stage === "render" ? capabilities.renderModes : stage === "auto" ? capabilities.autoModes : capabilities.modes)?.[targetMode];
        return capability?.enabled ? "" : capability?.reason || "此功能暂未开放。";
    };
    const retryAvailability = (project: ClipProject) => capabilityReason(project.mode, project.retryStage === "analyze" && project.plan?.autoRender ? "auto" : project.retryStage);
    const availability = capabilityReason(
        mode,
        selected?.status === "ready" || selected?.status === "rendering"
            ? "render"
            : selected?.status === "failed" || selected?.status === "cancelled"
              ? selected.retryStage === "analyze" && selected.plan?.autoRender
                  ? "auto"
                  : selected.retryStage
              : reviewBeforeRender
                ? "analyze"
                : "auto",
    );
    const createInput = useMemo<Omit<CreateClipInput, "idempotencyKey" | "expectedCredits">>(
        () => ({
            mode,
            sourceResourceId: source?.resourceId || "",
            materialResourceIds: mode === "mix" ? materials.map((item) => item.resourceId) : [],
            title: title.trim(),
            templateId,
            visual: mode === "behind" ? undefined : visual,
            referenceText: referenceText.trim(),
            autoRender: !reviewBeforeRender,
            trimStartMs,
            trimEndMs,
            musicResourceId: music?.resourceId,
            musicVolume,
            ...(mode === "behind" ? { behindText, behindPosition, subjectBox } : {}),
        }),
        [mode, source?.resourceId, materials, title, templateId, visual, referenceText, reviewBeforeRender, trimStartMs, trimEndMs, music?.resourceId, musicVolume, behindText, behindPosition, subjectBox],
    );
    const trimError = source?.durationMs ? clipTrimError(trimStartMs, trimEndMs, source.durationMs) : "";
    const quoteInput = useMemo(() => (selected ? { projectId: selected.id } : createInput), [selected?.id, createInput]);
    const quoteKey = JSON.stringify(quoteInput);
    const quote = quoted?.key === quoteKey && title.trim() ? quoted.value : null;
    const quoteEligible = Boolean(
        !availability &&
        !clipTitleError(title) &&
        (selected
            ? ["ready", "failed", "cancelled"].includes(selected.status)
            : createInput.sourceResourceId && createInput.templateId && !trimError && (mode !== "mix" || materials.length) && (mode !== "behind" || (behindText.trim() && validSubjectBox(subjectBox)))),
    );
    useEffect(() => {
        setQuoted(null);
        setQuoteError("");
        setQuoting(false);
        if (!quoteEligible) return;
        const controller = new AbortController();
        const timer = setTimeout(() => {
            setQuoting(true);
            void quoteClip(quoteInput, controller.signal)
                .then((result) => {
                    if (!Number.isFinite(result.credits) || result.credits < 0) throw new Error("积分报价读取失败，请重新获取。");
                    if (!controller.signal.aborted) setQuoted({ key: quoteKey, value: result });
                })
                .catch((e) => {
                    if (!controller.signal.aborted) setQuoteError(errorText(e));
                })
                .finally(() => {
                    if (!controller.signal.aborted) setQuoting(false);
                });
        }, 350);
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [quoteKey, quoteEligible, quoteRevision]);
    const requireQuote = () => {
        if (quote) return true;
        setError(quoteError || "正在确认剪辑积分，请稍候再提交。");
        return false;
    };
    const analyze = () => {
        if (blocked || availability || !source?.resourceId) return;
        const titleError = clipTitleError(title);
        if (titleError || trimError) {
            setError(titleError || trimError);
            return;
        }
        if (mode === "mix" && !materials.length) {
            setError("添加至少一段空镜或商品视频。");
            return;
        }
        if (mode === "behind" && (!behindText.trim() || !validSubjectBox(subjectBox))) {
            setError("先填写大字并在首帧框选人物。");
            return;
        }
        if (!requireQuote()) return;
        const input = { ...createInput, expectedCredits: quote!.credits };
        return perform(() => createClip({ ...input, idempotencyKey: keyFor(`create:${JSON.stringify(input)}`) }));
    };
    const effectivePlan = plan ? { ...plan, title: title.trim(), templateId, visual, referenceText, behindText, behindPosition, subjectBox, musicResourceId: music?.resourceId, musicVolume } : null;
    const planError = effectivePlan ? clipPlanError(effectivePlan, mode) : "";
    const patchPlan = (patch: Partial<ClipPlan>, editKey?: string) => {
        if (blocked || !plan) return;
        if (patch.transcript) setCaptionHistory((history) => recordCaptionEdit(history, plan.transcript, patch.transcript!, editKey));
        setPlan((current) => (current ? { ...current, ...patch } : current));
        setDirty(true);
    };
    const moveCaptions = (direction: "undo" | "redo") => {
        if (blocked || selected?.status !== "ready" || !plan) return;
        const result = moveCaptionHistory(captionHistory, plan.transcript, direction);
        if (!result) return;
        setCaptionHistory(result.history);
        setPlan({ ...plan, transcript: result.transcript });
        setDirty(true);
    };
    const save = () => {
        if (selected?.status !== "ready" || !effectivePlan || planError || blocked) return;
        return perform(() => saveClipPlan(selected.id, effectivePlan));
    };
    const render = () => {
        if (selected?.status !== "ready" || !effectivePlan || planError || availability || blocked) return;
        if (!requireQuote()) return;
        return perform(() => renderClip(selected.id, keyFor(`render:${selected.id}:${quote!.credits}:${JSON.stringify(effectivePlan)}`), effectivePlan, quote!.credits));
    };
    const cancel = (project: ClipProject) => perform(() => cancelClip(project.id), project.id === selectedId);
    const retry = (project: ClipProject) => {
        if (retryAvailability(project)) return;
        if (project.id !== selectedId) {
            restore(project);
            return;
        }
        if (!requireQuote()) return;
        return perform(() => retryClip(project.id, keyFor(`retry:${project.id}:${project.updatedAt}:${quote!.credits}`), quote!.credits));
    };
    const reload = () => (selected && !busy ? perform(() => getClip(selected.id)) : Promise.resolve(false));
    return {
        mode,
        chooseMode,
        source,
        setSource,
        materials,
        setMaterials,
        music,
        setMusic: (value: ClipMedia | null) => {
            setMusic(value);
            setDirty(true);
        },
        musicVolume,
        setMusicVolume: (value: number) => {
            setMusicVolume(value);
            setDirty(true);
        },
        uploadMusic,
        title,
        setTitle: (value: string) => {
            setTitle(value);
            setDirty(true);
        },
        templateId,
        setTemplateId: (value: string) => {
            setTemplateId(value);
            setVisual(capabilities?.templates.find((template) => template.id === value)?.visual);
            setDirty(true);
        },
        visual: mode === "behind" ? undefined : visual || capabilities?.templates.find((template) => template.id === templateId)?.visual,
        setVisual: (value: ShopClipVisual) => {
            setVisual(value);
            setDirty(true);
        },
        referenceText,
        setReferenceText: (value: string) => {
            setReferenceText(value);
            setDirty(true);
        },
        reviewBeforeRender,
        setReviewBeforeRender,
        trimStartMs,
        trimEndMs,
        setTrim: (start: number, end: number) => {
            setTrimStartMs(start);
            setTrimEndMs(end);
            if (start !== trimStartMs) setSubjectBox(undefined);
        },
        trimError,
        quote,
        quoteError,
        quoting,
        refreshQuote: () => setQuoteRevision((value) => value + 1),
        behindText,
        setBehindText: (value: string) => {
            setBehindText(value);
            setDirty(true);
        },
        behindPosition,
        setBehindPosition: (value: ClipPlan["behindPosition"]) => {
            setBehindPosition(value);
            setDirty(true);
        },
        subjectBox,
        setSubjectBox: (value: number[]) => {
            setSubjectBox(value);
            setDirty(true);
        },
        capabilities,
        availability,
        refreshCapabilities,
        projects,
        selected,
        plan: effectivePlan,
        patchPlan,
        editorRevision,
        canUndoCaptions: captionHistory.past.length > 0,
        canRedoCaptions: captionHistory.future.length > 0,
        undoCaptions: () => moveCaptions("undo"),
        redoCaptions: () => moveCaptions("redo"),
        endCaptionEdit: () => setCaptionHistory((history) => ({ ...history, editKey: undefined })),
        planError,
        dirty,
        error,
        setError,
        historyError,
        loading,
        busy,
        blocked,
        upload,
        uploadFiles,
        pickMedia,
        cancelUpload: () => uploadController.current?.abort(),
        refresh,
        select: restore,
        startNew,
        analyze,
        save,
        render,
        cancel,
        retry,
        retryAvailability,
        reload,
    };
}

export type VideoEditState = ReturnType<typeof useVideoEdit>;
