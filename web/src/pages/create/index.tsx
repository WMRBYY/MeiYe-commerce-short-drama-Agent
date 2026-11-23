import { workspacePath, workspaceTeamId } from "@/lib/workspace-routes";
import { captureSkillLibraryAccess, hasSkillLibraryAccess, isSkillLibraryAccessCurrent, useSkillLibraryAccess } from "@/lib/skill-access";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { App, Button, Spin } from "antd";
import { Tooltip } from "@/components/ui/base/tooltip";
import { History, Maximize2, PenLine, Sparkles } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useNavigate, useSearchParams } from "react-router";
import { Trans, useTranslation } from "react-i18next";

import { translate } from "@/i18n";
import type { AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { PersonalSpaceCreditOverview } from "@/components/layout/team-space-directory";
import { generationErrorCode, generationErrorMessage } from "@/lib/generation-error";
import { useGenerationBatchLimit } from "@/lib/generation-batch-limit";
import { isGenerationCostUncertainError } from "@/lib/canvas/canvas-generation-batch";
import { imageParameterRequest, normalizeImageParameters } from "@/lib/image-parameters";
import { creationResultAssetIds } from "@/lib/canvas/canvas-asset-handoff";
import { getActiveUserScope } from "@/lib/user-scope";
import { audioUploadTitleFromFileName } from "@/lib/audio-upload-title";
import { continueCreationConversationOnCanvas } from "@/services/creation-canvas-conversation";
import { useExternalAssetSources } from "@/hooks/use-external-asset-sources";
import { LEGACY_TEXT_THINKING_CONFIG, isThinkingLevel, resolveThinkingLevel, thinkingLevelsFor, type ThinkingLevel, type ThinkingRequest } from "@/lib/text-thinking";
import { modelCapabilityConfigFor, videoDurationAllowed, videoDurationOptions } from "@/lib/model-capabilities";
import { preserveImageSettings as normalizeImageValue, mediaSettingIssues } from "@/lib/media-settings";
import { inferVideoOperation, modelCompatibilityError, modelGroupReferenceLimits, resolveCompatibleModel, mergedImageCapabilityConfig, type ModelRequirements } from "@/lib/model-selection";
import type { BackendGenerationResult } from "@/services/api/generation-task";
import type { Skill } from "@/services/api/skills";
import { listGenerationTasks, type GenerationTask } from "@/services/api/task-center";
import {
    announceActiveCreationConversation,
    CREATION_CONVERSATION_REQUEST_EVENT,
    loadCreationConversations,
    pendingCreationTaskIds,
    removeCreationConversationSnapshot,
    saveCreationConversations,
    updateCreationConversationSnapshot,
    type CreationConversationRequest,
} from "@/services/creation-conversation-store";
import { readCreationConversationSnapshot, writeCreationConversationSnapshot } from "@/services/creation-conversation-snapshot";
import { localForageStorageForScope } from "@/lib/localforage-storage";
import { creationHistoryAPI } from "@/services/api/creation-history";
import { CreationHistorySync, CREATION_HISTORY_SYNC_KEY, type HistorySyncStatus } from "@/services/creation-history-sync";
import { creationHistoryMedia, restoreHistoryMedia } from "@/services/creation-history-media";
import { resolveModelChannel, resolveModelRequestConfig, selectableModelsByCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useCreationPreferencesStore } from "@/stores/use-creation-preferences-store";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { deleteAssetsWithRemoteSync, loadAssetsForUse, saveRemoteUserDataNow } from "@/services/user-data-sync";
import { displayCreationPrompt } from "./creation-references";
import { CreationBlankConversation } from "./creation-blank-conversation";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { useThemePack } from "@/themes/use-theme-pack";
import { cn } from "@/lib/utils";
import { useUserStore } from "@/stores/use-user-store";
import type { PromptOptimizerProvider } from "@/lib/plugins/plugin-types";
import { promptOptimizerPlugin, PROMPT_OPTIMIZER_PLUGIN_ID } from "@/lib/plugins/builtin/prompt-optimizer";
import { createPluginHostContext } from "@/services/plugin-host";
import { usePluginStore } from "@/stores/use-plugin-store";
import {
    buildCreationMentionReferences,
    expandCreationPrompt,
    reconcileCreationAttachmentLimit,
    reconcileCreationAttachmentLimits,
    removeCreationReferenceTokens,
    replaceCreationAttachmentReference,
    selectedCreationReferences,
    type CreationReference,
} from "./creation-references";
import {
    creationAttachmentFromAudio,
    creationAttachmentFromDocument,
    creationAttachmentFromImage,
    creationAttachmentFromVideo,
    creationAttachmentKind,
    creationAudioAsset,
    creationFileAccepted,
    creationImageAsset,
    creationMediaAspectRatio,
    creationUploadAccept,
    creationVideoAsset,
    removeCreationAttachment,
    splitCreationAttachments,
    type CreationAttachment,
} from "./creation-assets";
import { creationLibraryDisabledReason, creationLibrarySelectionToAttachments } from "./creation-library";
import {
    defaultCreationMode,
    defaultImageCount,
    defaultImageResolution,
    modeLabels,
    type CreationConversation,
    type CreationMessage,
    type CreationMode,
    type CreationRetryContext,
    type CreationSettings,
    type CreationShotRailEntry,
    type CreationStatus,
} from "./creation-types";
import {
    attachCreationTaskContexts,
    completedCreationGenerationTask,
    conversationTimestamp,
    creationImageSlots,
    creationMessageNeedsResultSync,
    creationShotRail,
    creationVideoShotOrdinal,
    isImageAttachment,
    isVideoAttachment,
    materializeCreationTaskResults,
    newConversation,
    newMessage,
    reconcileCreationTaskMessages,
    type PersistedCreationTask,
} from "./creation-conversations";
import { CreationComposer, CreationEmptySuggest, CreationHistoryDrawer, CreationMessageView, CreationWorkspaceToolbar, creationAssetCategoryLabels } from "./creation-workspace";
import { HomeMentionButton, HomeModeMenu, HomeSkillsButton, type HomeMode } from "./home/home-composer-tools";
import { HomeSkillChips } from "./home/home-skill-chips";
import { HomeFeatureShowcase } from "./home/home-feature-showcase";
import { HomeGallery } from "./home/home-gallery";
import { HomeCanvasPanel } from "./home/home-canvas-panel";
import { HomeAudioComposer } from "./home/home-audio-composer";
import { HomeAmbientBackdrop, HomeSurfaceSwitch, type HomeSurface } from "./home/home-hero";
import { buildSkillMentionReferences } from "@/services/skill-runtime";
import { canvasResourceMentionToken } from "@/lib/canvas/canvas-resource-references";
import "./home/home-jimeng.css";
import { cheerYoru } from "@/lib/yoru-events";
import { appendCreationReference, creationAttachmentFromResult, type CreationReferenceDrop } from "./creation-reference-drop";
import { CreationHistoryConflicts } from "./creation-history-conflicts";
import { createCreationSubmitGate } from "./creation-submit-gate";
import { creationVideoConfig, creationVideoSettings } from "./creation-generation-config";
import { CreationLoginDialog } from "./creation-login-dialog";
import { mightContainCreationImage, normalizeTransferredImage, readCreationImageTransfer } from "./creation-image-transfer";
import { creationAttachmentFromAsset } from "./creation-assets";
import { importResourceFromUrl, resourceFileUrl, resourceStorageKey } from "@/services/api/resources";
import { trackSiteTrafficAction } from "@/services/site-traffic";

const AssetLibraryPickerModal = lazy(() => import("@/components/assets/asset-library-picker-modal").then((module) => ({ default: module.AssetLibraryPickerModal })));
const loadCreationRuntime = () => import("./creation-runtime");
type CreationRuntime = Awaited<ReturnType<typeof loadCreationRuntime>>;

const TEXT_STREAMING_PREF_KEY = "creation.composer.text-streaming";
// 思考档位按模型分别记住：{ [model]: level }。只存小型 UI 偏好。
const TEXT_THINKING_LEVELS_PREF_KEY = "creation.composer.text-thinking-levels";

function readThinkingLevelPrefs(): Record<string, ThinkingLevel> {
    try {
        const parsed = JSON.parse(window.localStorage.getItem(TEXT_THINKING_LEVELS_PREF_KEY) || "{}") as Record<string, unknown>;
        return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, ThinkingLevel] => isThinkingLevel(entry[1])));
    } catch {
        return {};
    }
}

function writeThinkingLevelPrefs(value: Record<string, ThinkingLevel>) {
    try {
        window.localStorage.setItem(TEXT_THINKING_LEVELS_PREF_KEY, JSON.stringify(value));
    } catch {
        // 存储不可用：仅当前会话生效
    }
}

const GUEST_CREATION_DRAFT_KEY = "meiye:guest-creation-draft";

function readGuestCreationDraft(): { prompt: string; mode: CreationMode } | null {
    try {
        const value = JSON.parse(window.sessionStorage.getItem(GUEST_CREATION_DRAFT_KEY) || "null");
        if (!value || typeof value.prompt !== "string" || !["text", "image", "video"].includes(value.mode)) return null;
        return { prompt: value.prompt, mode: value.mode };
    } catch {
        return null;
    }
}

function readComposerPref(key: string, fallback: boolean): boolean {
    try {
        const stored = window.localStorage.getItem(key);
        return stored === null ? fallback : stored === "1";
    } catch {
        return fallback;
    }
}
function writeComposerPref(key: string, value: boolean) {
    try {
        window.localStorage.setItem(key, value ? "1" : "0");
    } catch {
        // 存储不可用（隐私模式/禁用）：仅当前会话生效，忽略
    }
}

export default function CreatePage() {
    const { t } = useTranslation();
    const [guestDraft] = useState(readGuestCreationDraft);
    // 首页「生成 / 画布」两个面板；音乐与音频走独立的音频生成面板，其余类型映射到既有创作模式（Agent 即文本模式）。
    const [homeSurface, setHomeSurface] = useState<HomeSurface>("generate");
    const [audioMode, setAudioMode] = useState<"music" | "audio" | null>(null);
    const { message: toast, modal } = App.useApp();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const [openingCanvas, setOpeningCanvas] = useState(false);
    const openingCanvasRef = useRef(false);
    const brandName = useAppearanceStore((state) => state.appearance.brandName);
    // 首页问候直接称呼用户昵称（没有昵称时回落到用户名），游客显示“你好”。
    const greetingName = useUserStore((state) => (state.user?.displayName || state.user?.username || "").trim()).slice(0, 16);
    const config = useEffectiveConfig();
    const composerPreferencesHydrated = useCreationPreferencesStore((state) => state.hydrated);
    const rememberMode = useCreationPreferencesStore((state) => state.rememberMode);
    const rememberImageSettings = useCreationPreferencesStore((state) => state.rememberImageSettings);
    const rememberVideoSettings = useCreationPreferencesStore((state) => state.rememberVideoSettings);
    const initialComposerPreferences = useCreationPreferencesStore.getState().preferences;
    const promptOptimizerInstallation = usePluginStore((state) => state.installations.find((item) => item.manifest.id === PROMPT_OPTIMIZER_PLUGIN_ID));
    const promptOptimizerEnabled = usePluginStore((state) => state.pluginStates[PROMPT_OPTIMIZER_PLUGIN_ID]?.effectiveEnabled ?? Boolean(state.installations.find((item) => item.manifest.id === PROMPT_OPTIMIZER_PLUGIN_ID)?.enabled));
    const promptOptimizerProvider = useMemo<PromptOptimizerProvider | null>(() => {
        if (!promptOptimizerEnabled || !promptOptimizerInstallation || !promptOptimizerPlugin.createPromptOptimizer) return null;
        return promptOptimizerPlugin.createPromptOptimizer(createPluginHostContext(promptOptimizerPlugin, promptOptimizerInstallation, config));
    }, [config, promptOptimizerEnabled, promptOptimizerInstallation]);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const assets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);
    const userId = useUserStore((state) => state.user?.id || null);
    const userSessionHydrated = useUserStore((state) => state.hydrated);
    // 一次可选张数按账号同时任务数，硬上限仍为 15；每张图仍拆成独立任务提交。
    const imageBatchLimit = Math.min(15, useGenerationBatchLimit());
    const activeConversationScope = getActiveUserScope();
    const initialConversationSnapshot = userSessionHydrated ? readCreationConversationSnapshot<CreationConversation>(activeConversationScope) : null;
    const [conversations, setConversations] = useState<CreationConversation[]>(() => initialConversationSnapshot || []);
    const conversationsRef = useRef<CreationConversation[]>(initialConversationSnapshot || []);
    const [activeId, setActiveId] = useState(() => initialConversationSnapshot?.[0]?.id || "");
    const activeIdRef = useRef(activeId);
    const [hydrated, setHydrated] = useState(() => Boolean(initialConversationSnapshot?.length));
    const [conversationStorageReady, setConversationStorageReady] = useState(false);
    const [conversationStorageError, setConversationStorageError] = useState(guestDraft?.prompt || "");
    const [conversationLoadAttempt, setConversationLoadAttempt] = useState(0);
    const historySessionRef = useRef<CreationHistorySync | null>(null);
    const historyTimerRef = useRef<number | null>(null);
    const remoteHistorySnapshots = useRef(new WeakSet<CreationConversation[]>());
    const [historySync, setHistorySync] = useState<HistorySyncStatus>({ phase: "local" });
    const inspirationSourcesVisible = useUserStore((state) => state.features.inspirationSourcesVisible);
    const [conversationScope, setConversationScope] = useState<string | null>(() => (initialConversationSnapshot ? activeConversationScope : null));
    const [mode, setMode] = useState<CreationMode>(() => (workspaceTeamId ? "text" : searchParams.get("workflow") === "dance" ? "video" : guestDraft?.mode || initialComposerPreferences.mode || defaultCreationMode));
    const [danceReplication, setDanceReplication] = useState(() => !workspaceTeamId && searchParams.get("workflow") === "dance");
    const [prompt, setPrompt] = useState(searchParams.get("workflow") === "dance" ? "让参考角色图中的人物按照参考视频复现舞蹈动作和节奏，保持角色面部、发型、服装和体型一致。" : guestDraft?.prompt || "");
    const [attachments, setAttachments] = useState<CreationAttachment[]>([]);
    const promptRef = useRef(prompt);
    const attachmentsRef = useRef(attachments);
    const [draftReferences, setDraftReferences] = useState<CreationReference[]>([]);
    const canUseSkills = useSkillLibraryAccess();
    const [addedSkills, setAddedSkills] = useState<Skill[]>([]);
    const addedSkillsRequestedRef = useRef(false);
    const [ratio, setRatio] = useState("16:9");
    const [seconds, setSeconds] = useState("6");
    const [quality, setQuality] = useState("auto");
    const [imageResolution, setImageResolution] = useState("auto");
    const [imageParameters, setImageParameters] = useState("{}");
    const [videoQuality, setVideoQuality] = useState(config.vquality || "720");
    const [count, setCount] = useState(String(Math.max(1, Math.min(10, Number(config.count) || 1))));
    const [textStreaming, setTextStreaming] = useState(() => readComposerPref(TEXT_STREAMING_PREF_KEY, true));
    const [textThinkingPrefs, setTextThinkingPrefs] = useState(readThinkingLevelPrefs);
    const [busy, setBusy] = useState(false);
    const [referenceReplacementBusy, setReferenceReplacementBusy] = useState(false);
    const [draggingImages, setDraggingImages] = useState(false);
    const [uploadingDroppedImages, setUploadingDroppedImages] = useState(false);
    const [referenceDropBusy, setReferenceDropBusy] = useState(false);
    const referenceDropLock = useRef(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const historyRequested = Boolean(userId) && searchParams.get("history") === "conversations";
    const historyVisible = historyOpen || historyRequested;
    const closeHistory = () => {
        setHistoryOpen(false);
        if (historyRequested)
            setSearchParams(
                (current) => {
                    const next = new URLSearchParams(current);
                    next.delete("history");
                    return next;
                },
                { replace: true },
            );
    };
    const [loginDialogOpen, setLoginDialogOpen] = useState(false);
    const [libraryOpen, setLibraryOpen] = useState(false);
    const externalAssetSources = useExternalAssetSources(Boolean(userId) && libraryOpen && !workspaceTeamId);
    const abortRef = useRef<AbortController | null>(null);
    const composerFocusRef = useRef<HTMLTextAreaElement>(null);
    const threadScrollRef = useRef<HTMLElement>(null);
    const launchpadRef = useRef<HTMLElement>(null);
    const inspirationSectionRef = useRef<HTMLElement | null>(null);
    const reducedMotion = useReducedMotion();
    const [launchpadCondensed, setLaunchpadCondensed] = useState(false);
    const followLatestMessageRef = useRef(true);
    const taskSyncWarningRef = useRef(false);
    const activeGenerationTaskIdsRef = useRef(new Set<string>());
    const retryPreparingRef = useRef(new Set<string>());
    const submitGateRef = useRef(createCreationSubmitGate());
    const pendingRetryRef = useRef<{ context: CreationRetryContext; lockKey: string } | null>(null);
    const [retrySequence, setRetrySequence] = useState(0);
    // 递增即重建恢复监听：订阅服务会缓存已结束的任务快照，任务被重新拉起或交接时需要重新订阅。
    const [recoveryEpoch, setRecoveryEpoch] = useState(0);
    const resultRefreshIdsRef = useRef(new Set<string>());
    const [resultRefreshIds, setResultRefreshIds] = useState<ReadonlySet<string>>(() => new Set());
    const resultRefreshControllersRef = useRef(new Set<AbortController>());
    const [composerPreferencesInitialized, setComposerPreferencesInitialized] = useState(false);
    promptRef.current = prompt;
    attachmentsRef.current = attachments;

    const requireLogin = useCallback(() => {
        const session = useUserStore.getState();
        if (session.hydrated && session.user) return true;
        setLoginDialogOpen(true);
        return false;
    }, []);

    useEffect(() => {
        // Applying a login session temporarily unmounts the workspace. Keep only
        // this tab's anonymous text draft through that transition, never media.
        try {
            if (userId || !prompt) window.sessionStorage.removeItem(GUEST_CREATION_DRAFT_KEY);
            else window.sessionStorage.setItem(GUEST_CREATION_DRAFT_KEY, JSON.stringify({ prompt, mode }));
        } catch {
            // Private browsing can disable sessionStorage; the live draft remains usable.
        }
    }, [mode, prompt, userId]);

    const activeConversation = useMemo(() => conversations.find((item) => item.id === activeId) || conversations[0], [activeId, conversations]);
    const historyConversations = useMemo(
        () => conversations.filter((conversation) => conversation.id === activeId || conversation.messages.length > 0).sort((left, right) => conversationTimestamp(right.updatedAt) - conversationTimestamp(left.updatedAt)),
        [activeId, conversations],
    );
    const preferredModel = mode === "text" ? config.textModel : mode === "image" ? config.imageModel : config.videoModel;
    const hasPrompt = Boolean(prompt.trim());
    const modelRequirements = useMemo<ModelRequirements>(
        () => ({
            capability: mode,
            input: {
                textCount: hasPrompt ? 1 : 0,
                imageCount: attachments.filter(isImageAttachment).length,
                videoCount: attachments.filter(isVideoAttachment).length,
                audioCount: attachments.filter((attachment) => creationAttachmentKind(attachment) === "audio").length,
                characterCount: 0,
            },
            videoSeconds: mode === "video" ? seconds : undefined,
            imageSize: mode === "image" ? ratio : undefined,
            options:
                mode === "image"
                    ? (imageParameterRequest(modelCapabilityConfigFor(config, preferredModel).image!, { ...config, size: ratio, imageResolution, quality, count, imageParameters }) ?? {
                          size: ratio,
                          imageResolution,
                          quality,
                          count: Number(count),
                          transparentBackground: config.transparentBackground === "true",
                      })
                    : mode === "video"
                      ? { size: ratio, videoSeconds: Number(seconds), vquality: videoQuality }
                      : {},
        }),
        [attachments, config, preferredModel, count, hasPrompt, imageResolution, imageParameters, mode, quality, ratio, seconds, videoQuality],
    );
    const selectedModel = resolveCompatibleModel(config, preferredModel, modelRequirements) || preferredModel;
    const generationConfig = useMemo(
        () =>
            mode === "video"
                ? creationVideoConfig(config, selectedModel, { ratio, seconds, videoQuality })
                : mode === "image"
                  ? { ...config, model: selectedModel, imageModel: selectedModel, size: ratio, quality, imageResolution, imageParameters, count }
                  : config,
        [config, mode, ratio, seconds, selectedModel, videoQuality, quality, imageResolution, imageParameters, count],
    );
    const imageProfile = useMemo(() => modelCapabilityConfigFor(config, selectedModel).image!, [config, selectedModel]);
    const videoProfile = useMemo(() => modelCapabilityConfigFor(config, selectedModel).video!, [config, selectedModel]);
    const textThinkingConfig = useMemo(() => (mode === "text" ? modelCapabilityConfigFor(config, selectedModel).text?.thinking || LEGACY_TEXT_THINKING_CONFIG : undefined), [config, mode, selectedModel]);
    const textThinkingLevels = useMemo(() => thinkingLevelsFor(textThinkingConfig), [textThinkingConfig]);
    // 记住的档位已不被模型支持时按后端同一规则就近取档；没记住时用模型默认值。
    const textThinkingLevel = resolveThinkingLevel(textThinkingConfig, textThinkingPrefs[selectedModel] || "auto");
    const textThinkingRequest = textThinkingPrefs[selectedModel] || "auto";
    const setTextThinkingLevel = (level: ThinkingRequest) => {
        setTextThinkingPrefs((current) => {
            const next = { ...current };
            if (isThinkingLevel(level)) next[selectedModel] = level;
            else delete next[selectedModel];
            writeThinkingLevelPrefs(next);
            return next;
        });
    };
    // 同名逻辑模型可能把文生视频、图生视频和全模态参考拆到不同路由。
    // 入口需要展示整个模型组的引用能力，添加素材后再由兼容路由选择具体模型。
    const videoReferenceLimits = useMemo(() => (mode === "video" ? modelGroupReferenceLimits(config, preferredModel || selectedModel, "video") || { maxImages: 0, maxVideos: 0, maxAudios: 0 } : undefined), [config, mode, preferredModel, selectedModel]);
    const maxReferences = mode === "video" ? (videoReferenceLimits?.maxImages || 0) + (videoReferenceLimits?.maxVideos || 0) + (videoReferenceLimits?.maxAudios || 0) : mode === "image" ? imageProfile.references.maxImages : 6;
    const referenceImageSize = useMemo(() => {
        const imageAttachments = attachments.filter(isImageAttachment);
        if (imageAttachments.length !== 1) return undefined;
        const { width, height } = imageAttachments[0];
        if (typeof width !== "number" || typeof height !== "number" || width <= 0 || height <= 0) return undefined;
        return { width, height };
    }, [attachments]);
    const mentionReferences = useMemo(
        () =>
            buildCreationMentionReferences(
                canUseSkills ? addedSkills : [],
                attachments,
                draftReferences.filter((reference) => canUseSkills || (reference.kind !== "skill" && !reference.skill)),
            ),
        [addedSkills, attachments, draftReferences, canUseSkills],
    );
    const isEmpty = !activeConversation?.messages.length;
    // 首页大屏只在「创作」首页（地址不带对话）显示；新建的空对话停留在对话视图，显示空状态。
    const showHomeLaunchpad = isEmpty && !searchParams.get("conversation");

    // 空首页从顶部开始；有消息的对话由跟随消息逻辑管理滚动。
    useLayoutEffect(() => {
        if (!hydrated || !isEmpty) return;
        const frame = window.requestAnimationFrame(() => {
            threadScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
        });
        return () => window.cancelAnimationFrame(frame);
    }, [activeId, hydrated, isEmpty]);
    const pendingTaskIds = useMemo(() => pendingCreationTaskIds(conversations), [conversations]);
    const unboundTaskMessages = useMemo(
        () =>
            conversations.flatMap((conversation) =>
                conversation.messages.flatMap((message) => (message.role === "assistant" && (message.status === "pending" || message.status === "streaming") && !message.taskIds?.length ? [{ conversationId: conversation.id, messageId: message.id }] : [])),
            ),
        [conversations],
    );
    const unboundTaskKey = unboundTaskMessages.map((message) => `${message.conversationId}:${message.messageId}`).join("|");
    const recoveryTaskKey = useMemo(() => {
        const ids = pendingTaskIds.filter((id) => !activeGenerationTaskIdsRef.current.has(id));
        return ids.length ? `${recoveryEpoch}:${ids.join("|")}` : "";
    }, [pendingTaskIds, recoveryEpoch]);
    const videoShots = useMemo(() => creationShotRail(activeConversation?.messages || []), [activeConversation]);
    const jumpToShot = (shot: CreationShotRailEntry) => {
        const id = shot.result?.id;
        if (id) document.getElementById(`creation-shot-${id}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
    };

    useEffect(() => {
        writeComposerPref(TEXT_STREAMING_PREF_KEY, textStreaming);
    }, [textStreaming]);
    useEffect(() => {
        if (!composerPreferencesHydrated || composerPreferencesInitialized) return;
        const saved = useCreationPreferencesStore.getState().preferences;
        const nextMode = workspaceTeamId ? "text" : guestDraft?.mode || saved.mode || defaultCreationMode;
        setMode(nextMode);
        if (nextMode === "image" && saved.image) {
            if (saved.image.ratio) setRatio(saved.image.ratio);
            if (saved.image.quality) setQuality(saved.image.quality);
            if (saved.image.count) setCount(saved.image.count);
        }
        if (nextMode === "video" && saved.video) {
            if (saved.video.ratio) setRatio(saved.video.ratio);
            if (saved.video.seconds) setSeconds(saved.video.seconds);
            if (saved.video.videoQuality) setVideoQuality(saved.video.videoQuality);
        }
        setComposerPreferencesInitialized(true);
    }, [composerPreferencesHydrated, composerPreferencesInitialized, guestDraft]);

    useEffect(() => {
        if (!composerPreferencesHydrated || !composerPreferencesInitialized || mode !== "image") return;
        const saved = useCreationPreferencesStore.getState().preferences.image;
        // 优先恢复用户上次选择；没有记住时默认 4K、4 张（模型不支持 4K 时用模型默认档位）。
        // 只有当前模型不支持该值时，normalizeImageValue 才回退到模型默认值。
        const prefer4k = (values: string[], fallback: string) => (values.some((value) => value.toLowerCase() === defaultImageResolution) ? values.find((value) => value.toLowerCase() === defaultImageResolution)! : fallback);
        const defaultResolution = imageProfile.resolution.supported ? prefer4k(imageProfile.resolution.values, imageProfile.resolution.default) : imageProfile.resolution.default;
        const defaultQuality = !imageProfile.resolution.supported ? prefer4k(imageProfile.quality.values, imageProfile.quality.default) : imageProfile.quality.default;
        const savedCount = saved?.count || defaultImageCount;
        const normalized = normalizeImageValue(imageProfile, {
            size: saved?.ratio || imageProfile.size.default,
            quality: saved?.quality || defaultQuality,
            imageResolution: saved?.imageResolution || defaultResolution,
            imageParameters: saved?.model === selectedModel ? saved.imageParameters : undefined,
            count: savedCount,
        });
        setRatio(normalized.size);
        setQuality(normalized.quality);
        setImageResolution(normalized.imageResolution || imageProfile.resolution.default);
        setImageParameters(JSON.stringify(normalizeImageParameters(imageProfile.parameters, saved?.model === selectedModel ? saved.imageParameters : undefined)));
        setCount(String(Math.max(1, Math.min(imageBatchLimit, Number(normalized.count || savedCount) || 1))));
    }, [composerPreferencesHydrated, composerPreferencesInitialized, mode, selectedModel, imageProfile]);

    useEffect(() => {
        if (!composerPreferencesHydrated || !composerPreferencesInitialized || mode !== "video") return;
        const saved = useCreationPreferencesStore.getState().preferences.video;
        // 恢复旧消息或偏好时使用与最终提交相同的目标协议适配。
        const normalized = creationVideoSettings(config, selectedModel, saved);
        setSeconds(normalized.seconds);
        setRatio(normalized.ratio);
        setVideoQuality(normalized.videoQuality);
    }, [composerPreferencesHydrated, composerPreferencesInitialized, mode, selectedModel, videoProfile]);

    useEffect(() => {
        const reconciled = mode === "video" && videoReferenceLimits ? reconcileCreationAttachmentLimits(attachments, mentionReferences, videoReferenceLimits) : reconcileCreationAttachmentLimit(attachments, mentionReferences, maxReferences);
        if (reconciled.attachments === attachments) return;
        setAttachments(reconciled.attachments);
        if (reconciled.removedReferences.length) setPrompt((current) => removeCreationReferenceTokens(current, reconciled.removedReferences));
    }, [attachments, maxReferences, mentionReferences, mode, videoReferenceLimits]);

    useEffect(() => {
        if (!userSessionHydrated) return;
        const scope = getActiveUserScope();
        const controller = new AbortController();
        const active = () => !controller.signal.aborted && getActiveUserScope() === scope && (useUserStore.getState().user?.id || null) === userId;
        const storage = localForageStorageForScope(scope);
        setConversationStorageReady(false);
        setConversationStorageError("");
        setHydrated(false);
        const display = (items: CreationConversation[]) => {
            if (!active()) return;
            const next = items.length ? items.map((item) => ({ ...item, messages: item.messages.map(restoreHistoryMedia) })) : [newConversation()];
            remoteHistorySnapshots.current.add(next);
            conversationsRef.current = next;
            writeCreationConversationSnapshot(scope, next);
            setConversations(next);
            setActiveId((current) => (next.some((item) => item.id === current) ? current : next[0].id));
            setConversationScope(scope);
        };
        const session = new CreationHistorySync({
            read: async () => await storage.getItem(CREATION_HISTORY_SYNC_KEY),
            readLegacy: () => loadCreationConversations<CreationConversation>(scope),
            write: async (value) => {
                await storage.setItem(CREATION_HISTORY_SYNC_KEY, value);
                if (active()) window.dispatchEvent(new CustomEvent("creation-conversations:changed", { detail: { scope } }));
            },
            api: creationHistoryAPI(scope, controller.signal),
            prepare: creationHistoryMedia(scope, controller.signal, active),
            cloud: Boolean(userId),
            active,
            onChange: display,
            onStatus: (status) => {
                if (active()) setHistorySync(status);
            },
        });
        historySessionRef.current = session;
        void session
            .load()
            .then((items) => {
                if (!active()) return;
                display(items);
                setConversationStorageReady(true);
                setHydrated(true);
                void session.sync();
            })
            .catch((error: unknown) => {
                if (active()) setConversationStorageError(error instanceof Error ? error.message : "读取本地创作记录失败");
            });
        const refresh = () => {
            if (active() && document.visibilityState !== "hidden") void session.sync();
        };
        window.addEventListener("online", refresh);
        window.addEventListener("focus", refresh);
        document.addEventListener("visibilitychange", refresh);
        const poll = window.setInterval(refresh, 15000);
        return () => {
            controller.abort();
            session.dispose();
            if (historySessionRef.current === session) historySessionRef.current = null;
            if (historyTimerRef.current) window.clearTimeout(historyTimerRef.current);
            historyTimerRef.current = null;
            window.clearInterval(poll);
            window.removeEventListener("online", refresh);
            window.removeEventListener("focus", refresh);
            document.removeEventListener("visibilitychange", refresh);
        };
    }, [guestDraft, userId, userSessionHydrated, conversationLoadAttempt]);

    const saveConversationHistory = useCallback(async (items: CreationConversation[]) => {
        const session = historySessionRef.current;
        if (!session) throw new Error("创作历史尚未就绪");
        await session.save(items);
        if (session !== historySessionRef.current) return;
        if (!historyTimerRef.current)
            historyTimerRef.current = window.setTimeout(() => {
                historyTimerRef.current = null;
                if (session === historySessionRef.current) void session.sync();
            }, 700);
    }, []);

    useEffect(() => () => abortRef.current?.abort(), []);

    useEffect(() => {
        activeIdRef.current = activeId;
    }, [activeId]);

    useEffect(() => {
        conversationsRef.current = conversations;
        if (!userSessionHydrated || !hydrated || !conversationStorageReady || conversationScope !== getActiveUserScope()) return;
        writeCreationConversationSnapshot(conversationScope, conversations);
        if (remoteHistorySnapshots.current.has(conversations)) return;
        void saveConversationHistory(conversations).catch((error) => {
            setHistorySync({ phase: "error", message: error instanceof Error ? error.message : "本地缓存写入失败" });
        });
    }, [conversations, conversationScope, hydrated, userSessionHydrated]);

    useEffect(() => {
        if (!userId || !userSessionHydrated || !hydrated || !unboundTaskKey) return;
        // A reload can interrupt the create response after Backend persisted the
        // task but before its ID reached this browser. The server's message ID
        // then identifies the original task without submitting or charging again.
        const expected = new Set(unboundTaskMessages.map((message) => `${message.conversationId}:${message.messageId}`));
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const check = async () => {
            try {
                const tasks = await listGenerationTasks(100, undefined, undefined, controller.signal);
                if (controller.signal.aborted) return;
                const matches = tasks.filter((task) => task.clientContext?.conversationId && task.clientContext.messageId && expected.has(`${task.clientContext.conversationId}:${task.clientContext.messageId}`));
                if (matches.length) {
                    const runtime = await loadCreationRuntime();
                    if (!controller.signal.aborted) setConversations((current) => reconcileCreationTaskMessages(runtime, current, matches));
                }
            } catch (error) {
                if (!controller.signal.aborted) console.warn("创作任务 ID 恢复失败，将继续重试", error);
            }
            if (!controller.signal.aborted) timer = setTimeout(check, 2_000);
        };
        void check();
        return () => {
            controller.abort();
            if (timer) clearTimeout(timer);
        };
    }, [hydrated, unboundTaskKey, userId, userSessionHydrated]);

    useEffect(() => {
        addedSkillsRequestedRef.current = false;
        setAddedSkills([]);
        setLibraryOpen(false);
        setHistoryOpen(false);
    }, [userId]);

    useEffect(
        () => () => {
            for (const controller of resultRefreshControllersRef.current) controller.abort();
            resultRefreshControllersRef.current.clear();
        },
        [],
    );

    useEffect(() => {
        setAddedSkills([]);
        addedSkillsRequestedRef.current = false;
    }, [canUseSkills, userId]);
    const loadAddedSkills = useCallback(() => {
        const access = captureSkillLibraryAccess();
        if (!access || addedSkillsRequestedRef.current) return;
        addedSkillsRequestedRef.current = true;
        void import("@/services/api/skills")
            .then(({ listAddedSkills }) => listAddedSkills())
            .then(({ skills }) => {
                if (isSkillLibraryAccessCurrent(access)) setAddedSkills(skills);
            })
            .catch(() => {
                if (isSkillLibraryAccessCurrent(access)) {
                    addedSkillsRequestedRef.current = false;
                    setAddedSkills([]);
                }
            });
    }, []);

    useEffect(() => {
        if (isEmpty || !followLatestMessageRef.current) return;
        const frame = window.requestAnimationFrame(() => {
            const container = threadScrollRef.current;
            if (container) container.scrollTop = container.scrollHeight;
        });
        return () => window.cancelAnimationFrame(frame);
    }, [activeConversation?.id, activeConversation?.messages, isEmpty]);

    const updateActive = useCallback(
        (updater: (conversation: CreationConversation) => CreationConversation) => {
            const next = updateCreationConversationSnapshot(conversationsRef.current, activeId, updater);
            conversationsRef.current = next;
            setConversations(next);
        },
        [activeId],
    );

    const updateConversationMessage = useCallback(async (conversationId: string, id: string, updater: (item: CreationMessage) => CreationMessage) => {
        const next = updateCreationConversationSnapshot(conversationsRef.current, conversationId, (conversation) => ({
            ...conversation,
            updatedAt: new Date().toISOString(),
            messages: conversation.messages.map((item) => (item.id === id ? updater(item) : item)),
        }));
        conversationsRef.current = next;
        setConversations(next);
        await saveConversationHistory(next);
    }, []);

    /**
     * 把后端任务快照接回创作消息：成功的任务先资源化再挂到对应消息上。
     * 刷新恢复、断线重连和“重新获取结果”共用这一条链路，只读取原任务，从不创建新任务。
     */
    const applyCreationTaskSnapshots = useCallback(
        async (runtime: CreationRuntime, tasks: GenerationTask[], signal: AbortSignal): Promise<PersistedCreationTask[]> => {
            const session = historySessionRef.current;
            const scope = getActiveUserScope();
            const active = () => !signal.aborted && session === historySessionRef.current && scope === getActiveUserScope();
            const contextual = attachCreationTaskContexts(tasks, conversationsRef.current);
            const persistedTasks = await materializeCreationTaskResults(runtime, contextual, signal);
            if (!active()) return persistedTasks;
            const attachable = persistedTasks.filter(
                (task) => task.status === "succeeded" && Boolean(task.clientContext?.conversationId && task.clientContext.messageId) && Boolean(task.creationResultUrls?.length || task.creationResultStorageKeys?.length),
            );
            for (const task of attachable) {
                const conversationId = task.clientContext!.conversationId!;
                const messageId = task.clientContext!.messageId!;
                try {
                    await runtime.consumeGenerationTaskMessage(
                        task,
                        messageId,
                        async ({ effectKey, resultUrls, resultStorageKeys }) => {
                            if (!active()) return;
                            await updateConversationMessage(
                                conversationId,
                                messageId,
                                (item) =>
                                    runtime.applyGenerationConsumerEffect(item, effectKey, (current) => ({
                                        ...current,
                                        status: current.mode === "image" ? ("pending" as const) : ("done" as const),
                                        content: current.mode === "video" ? translate("create.status.videoGenerated") : translate("create.status.imageGenerated"),
                                        error: undefined,
                                        errorKind: undefined,
                                        syncInterrupted: undefined,
                                        mediaRecoverable: undefined,
                                        generationStatus: current.mode === "image" ? current.generationStatus : ("succeeded" as const),
                                        ...(resultUrls.length ? { resultUrls: Array.from(new Set([...(current.resultUrls || []), ...resultUrls])) } : {}),
                                        ...(resultStorageKeys.length ? { resultStorageKeys: Array.from(new Set([...(current.resultStorageKeys || []), ...resultStorageKeys])) } : {}),
                                    })).value,
                            );
                        },
                        { signal, materialize: async () => task, materializedUrls: runtime.generationTaskMaterializedUrls, materializedStorageKeys: runtime.generationTaskMaterializedStorageKeys },
                    );
                } catch (error) {
                    if (signal.aborted) return persistedTasks;
                    console.warn("创作任务结果挂载失败，将使用已物化结果收敛消息状态", error);
                }
            }
            return persistedTasks;
        },
        [updateConversationMessage],
    );

    useEffect(() => {
        if (!userId || !userSessionHydrated || !hydrated || !recoveryTaskKey || !pendingTaskIds.length) return;
        // 当前页面主动提交的任务由 submit 自己等待并收尾；恢复监听只接管刷新前遗留、或 submit 交接过来的任务，避免同一任务被双重轮询。
        const recoverableTaskIds = pendingTaskIds.filter((id) => !activeGenerationTaskIdsRef.current.has(id));
        if (!recoverableTaskIds.length) return;
        let cancelled = false;
        const observationController = new AbortController();
        // 一条消息可能对应多张图的多个任务：保留每个任务的最新快照一起收敛，不会只看到其中一个就提前定论。
        const knownTasks = new Map<string, PersistedCreationTask>();
        const applyTasks = async (tasks: GenerationTask[]) => {
            const runtime = await loadCreationRuntime();
            const persistedTasks = await applyCreationTaskSnapshots(runtime, tasks, observationController.signal);
            if (cancelled) return;
            taskSyncWarningRef.current = false;
            for (const task of persistedTasks) knownTasks.set(task.id, task);
            setConversations((current) => reconcileCreationTaskMessages(runtime, current, [...knownTasks.values()]));
        };
        const warnSync = (error: unknown) => {
            if (cancelled || observationController.signal.aborted) return;
            console.warn("创作任务状态同步失败", error);
            if (!taskSyncWarningRef.current) {
                taskSyncWarningRef.current = true;
                toast.warning(translate("create.page.taskSyncFailed"));
            }
        };
        let applyChain = Promise.resolve();
        let unsubscribe: () => void = () => {};
        void loadCreationRuntime()
            .then((runtime) => {
                if (cancelled) return;
                unsubscribe = runtime.subscribeGenerationTasks(recoverableTaskIds, (task) => {
                    applyChain = applyChain.then(() => applyTasks([task])).catch(warnSync);
                });
            })
            .catch(warnSync);
        return () => {
            cancelled = true;
            observationController.abort();
            unsubscribe();
        };
    }, [applyCreationTaskSnapshots, hydrated, recoveryTaskKey, toast, userId, userSessionHydrated]);

    const beginResultRefresh = (messageId: string) => {
        if (resultRefreshIdsRef.current.has(messageId)) return null;
        resultRefreshIdsRef.current.add(messageId);
        setResultRefreshIds(new Set(resultRefreshIdsRef.current));
        const controller = new AbortController();
        resultRefreshControllersRef.current.add(controller);
        return {
            signal: controller.signal,
            finish() {
                resultRefreshControllersRef.current.delete(controller);
                resultRefreshIdsRef.current.delete(messageId);
                setResultRefreshIds(new Set(resultRefreshIdsRef.current));
            },
        };
    };

    // 重新查询原任务并接回结果：任务仍在进行就回到生成中继续跟进，已成功就补回作品；不会提交新任务。
    const refreshMessageResult = async (item: CreationMessage) => {
        const taskIds = item.taskIds || [];
        if (!taskIds.length) return;
        const refresh = beginResultRefresh(item.id);
        if (!refresh) return;
        const scope = getActiveUserScope();
        try {
            const runtime = await loadCreationRuntime();
            const tasks = await Promise.all(taskIds.map((id) => runtime.queryGenerationTask(id, { signal: refresh.signal })));
            if (refresh.signal.aborted || scope !== getActiveUserScope()) return;
            const persistedTasks = await applyCreationTaskSnapshots(runtime, tasks, refresh.signal);
            if (refresh.signal.aborted || scope !== getActiveUserScope()) return;
            setConversations((current) => reconcileCreationTaskMessages(runtime, current, persistedTasks, { reviveMessageIds: new Set([item.id]) }));
            if (tasks.some((task) => task.status === "queued" || task.status === "running")) {
                setRecoveryEpoch((value) => value + 1);
                toast.info(t("create.page.taskStillRunning"));
            } else if (persistedTasks.some((task) => task.status === "succeeded" && !task.creationResultUrls?.length && !task.creationResultStorageKeys?.length)) {
                toast.warning(t("create.page.resultNotLoaded"));
            }
        } catch (error) {
            if (refresh.signal.aborted || scope !== getActiveUserScope()) return;
            toast.error(t("create.page.resultFetchFailed", { reason: generationErrorMessage(error) }));
        } finally {
            refresh.finish();
        }
    };

    // 作品已生成但后端保存失败：重放保存检查点，不重新生成、不重复扣费，随后回到生成中跟进保存结果。
    const recoverMessageMedia = async (item: CreationMessage) => {
        const taskIds = item.taskIds || [];
        if (!taskIds.length) return;
        const refresh = beginResultRefresh(item.id);
        if (!refresh) return;
        const scope = getActiveUserScope();
        try {
            const runtime = await loadCreationRuntime();
            const recovered = await Promise.allSettled(taskIds.map((id) => runtime.recoverGenerationTaskMedia(id)));
            if (!recovered.some((entry) => entry.status === "fulfilled")) {
                const rejected = recovered.find((entry): entry is PromiseRejectedResult => entry.status === "rejected");
                throw rejected?.reason instanceof Error ? rejected.reason : new Error(t("create.page.resaveUnavailable"));
            }
            const tasks = await Promise.all(taskIds.map((id) => runtime.queryGenerationTask(id, { signal: refresh.signal })));
            if (refresh.signal.aborted || scope !== getActiveUserScope()) return;
            const persistedTasks = await applyCreationTaskSnapshots(runtime, tasks, refresh.signal);
            if (refresh.signal.aborted || scope !== getActiveUserScope()) return;
            setConversations((current) => reconcileCreationTaskMessages(runtime, current, persistedTasks, { reviveMessageIds: new Set([item.id]) }));
            setRecoveryEpoch((value) => value + 1);
        } catch (error) {
            if (refresh.signal.aborted || scope !== getActiveUserScope()) return;
            toast.error(t("create.page.resaveFailed", { reason: generationErrorMessage(error) }));
        } finally {
            refresh.finish();
        }
    };

    const selectMode = (next: CreationMode) => {
        if (workspaceTeamId && next !== "text") return;
        if (next !== "video") setDanceReplication(false);
        setMode(next);
        rememberMode(next);
        const nextModels = selectableModelsByCapability(config, next);
        const current = next === "text" ? config.textModel : next === "image" ? config.imageModel : config.videoModel;
        if (!nextModels.includes(current) && nextModels[0]) {
            updateConfig(next === "text" ? "textModel" : next === "image" ? "imageModel" : "videoModel", nextModels[0]);
        }
    };

    const setComposerRatio = (value: string) => {
        setRatio(value);
        if (mode === "image") rememberImageSettings({ ratio: value });
        if (mode === "video") rememberVideoSettings({ ratio: value });
    };
    const setComposerSeconds = (value: string) => {
        setSeconds(value);
        if (mode === "video") rememberVideoSettings({ seconds: value });
    };
    const setComposerQuality = (value: string) => {
        setQuality(value);
        if (mode === "image") rememberImageSettings({ quality: value });
    };
    const setComposerImageResolution = (value: string) => {
        setImageResolution(value);
        if (mode === "image") rememberImageSettings({ imageResolution: value });
    };
    const setComposerVideoQuality = (value: string) => {
        setVideoQuality(value);
        if (mode === "video") rememberVideoSettings({ videoQuality: value });
    };
    const setComposerCount = (value: string) => {
        setCount(value);
        if (mode === "image") rememberImageSettings({ count: value });
    };

    const externalLibraryItems = useMemo<AssetLibraryPickerItem[]>(
        () =>
            externalAssetSources.items.map((item) => ({
                ...item,
                disabledReason: creationLibraryDisabledReason(mode, item.external?.item.kind, videoReferenceLimits),
            })),
        [externalAssetSources.items, mode, videoReferenceLimits],
    );
    const libraryItems = useMemo<AssetLibraryPickerItem[]>(
        () => [
            ...assets
                .filter((asset) => (workspaceTeamId ? asset.kind === "text" : asset.kind === "image" || asset.kind === "video" || asset.kind === "audio"))
                .map((asset) => ({
                    id: asset.id,
                    title: asset.title,
                    category: asset.category || "other",
                    kindLabel: asset.kind === "text" ? t("library.picker.kind.text") : asset.kind === "video" ? t("create.kind.video") : asset.kind === "audio" ? t("create.kind.audio") : t("create.kind.image"),
                    archived: asset.status === "archived",
                    asset,
                    searchText: (asset.tags || []).join(" "),
                    disabledReason: creationLibraryDisabledReason(mode, asset.kind, videoReferenceLimits, Boolean(workspaceTeamId)),
                })),
            ...externalLibraryItems,
        ],
        [assets, externalLibraryItems, mode, videoReferenceLimits],
    );
    const uploadCreationAsset = async (file: File) => {
        if (!requireLogin()) throw new Error(t("create.homePage.loginToUpload"));
        const { uploadImage, uploadMediaFile } = await loadCreationRuntime();
        if (file.type.startsWith("video/")) {
            const uploaded = await uploadMediaFile(file, "create-upload");
            return {
                asset: creationVideoAsset({ title: file.name, uploaded, metadata: { source: "create-upload", fileName: file.name } }),
                attachment: creationAttachmentFromVideo(file, uploaded),
            };
        }
        if (file.type.startsWith("audio/")) {
            const uploaded = await uploadMediaFile(file, "create-upload");
            return {
                asset: creationAudioAsset({ title: audioUploadTitleFromFileName(file.name), uploaded, metadata: { source: "create-upload", fileName: file.name } }),
                attachment: creationAttachmentFromAudio(file, uploaded),
            };
        }
        if (!file.type.startsWith("image/")) {
            const uploaded = await uploadMediaFile(file, "create-upload");
            return { attachment: creationAttachmentFromDocument(file, uploaded) };
        }
        const uploaded = await uploadImage(file);
        return {
            asset: creationImageAsset({ title: file.name, uploaded, metadata: { source: "create-upload", fileName: file.name } }),
            attachment: creationAttachmentFromImage(file, uploaded),
        };
    };
    const uploadLibraryAssets = async (files: FileList | File[]) => {
        if (!requireLogin()) return [];
        const next = Array.from(files).filter((file) => creationFileAccepted(mode, file));
        if (!next.length) return [];
        const settled = await Promise.allSettled(
            next.map(async (file) => {
                const { asset } = await uploadCreationAsset(file);
                return asset ? addAsset(asset) : "";
            }),
        );
        const assetIds = settled.flatMap((entry) => (entry.status === "fulfilled" && entry.value ? [entry.value] : []));
        const failed = settled.filter((entry) => entry.status === "rejected");
        if (assetIds.length) toast.success(t("create.page.uploadSucceeded", { count: assetIds.length }));
        if (failed.length) toast.error(t("create.page.uploadFailed", { count: failed.length }));
        return assetIds;
    };

    const handleDroppedImages = async (files: File[]) => {
        if (!requireLogin()) return;
        if (uploadingDroppedImages || busy || referenceReplacementBusy) {
            toast.warning(t("create.homePage.waitBeforeAddingReference"));
            return;
        }
        if (maxReferences <= 0) {
            toast.warning(t("create.homePage.referencesUnsupported"));
            return;
        }
        setUploadingDroppedImages(true);
        try {
            const settled = await Promise.allSettled(files.map((file) => uploadCreationAsset(normalizeTransferredImage(file))));
            const uploaded = settled.flatMap((entry) => (entry.status === "fulfilled" ? [entry.value] : []));
            for (const item of uploaded) if (item.asset) addAsset(item.asset);
            if (uploaded.length) {
                setAttachments((current) => {
                    const candidates = [...current, ...uploaded.map((item) => item.attachment)];
                    const reconciled = mode === "video" && videoReferenceLimits ? reconcileCreationAttachmentLimits(candidates, mentionReferences, videoReferenceLimits) : reconcileCreationAttachmentLimit(candidates, mentionReferences, maxReferences);
                    if (reconciled.attachments.length < candidates.length) toast.warning(t("create.homePage.someImagesOverLimit"));
                    return reconciled.attachments;
                });
                toast.success(t("create.homePage.imagesAddedAsReference"));
            }
            if (settled.some((entry) => entry.status === "rejected")) toast.error(t("create.homePage.someImagesUploadFailed"));
        } finally {
            setUploadingDroppedImages(false);
        }
    };

    const handleImageTransfer = async (transfer: DataTransfer) => {
        const { files, assetId, url } = readCreationImageTransfer(transfer);
        if (!files.length && !assetId && !url) return;
        if (!requireLogin()) return;
        if (busy || referenceReplacementBusy || uploadingDroppedImages) {
            toast.warning(t("create.homePage.waitForSubmitOrUpload"));
            return;
        }
        if (maxReferences <= 0 || attachments.length >= maxReferences) {
            toast.warning(t("create.homePage.referenceLimitReached"));
            return;
        }
        if (files.length) {
            await handleDroppedImages(files);
            return;
        }
        if (assetId) {
            try {
                const localAsset = useAssetStore.getState().assets.find((item) => item.id === assetId && item.kind === "image");
                if (localAsset) {
                    // A freshly generated image may still be waiting for the normal delayed asset sync.
                    // Flush assets only, then keep the remote ownership check below.
                    await saveRemoteUserDataNow([]);
                }
                await loadAssetsForUse([assetId]);
                const asset = useAssetStore.getState().assets.find((item) => item.id === assetId);
                if (!asset || asset.kind !== "image") throw new Error(t("create.homePage.siteImageUnavailable"));
                const attachment = creationAttachmentFromAsset(asset);
                setAttachments((current) => reconcileCreationAttachmentLimit([...current.filter((item) => item.id !== attachment.id), attachment], [], maxReferences).attachments);
                toast.success(t("create.homePage.siteImageAdded"));
            } catch (error) {
                toast.error(error instanceof Error ? error.message : t("create.homePage.siteImageFailed"));
            }
            return;
        }
        if (!url) return;
        try {
            const resource = await importResourceFromUrl(url, "image");
            if (!resource.mimeType?.startsWith("image/")) throw new Error(t("create.homePage.linkNotImage"));
            const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || t("create.homePage.webImageName"));
            const uploaded = { url: resource.publicUrl || resourceFileUrl(resource.id), storageKey: resourceStorageKey(resource.id), width: resource.width || 0, height: resource.height || 0, bytes: resource.size || 0, mimeType: resource.mimeType };
            const file = new File([], name, { type: resource.mimeType });
            const attachment = creationAttachmentFromImage(file, uploaded);
            addAsset(creationImageAsset({ title: name, uploaded, metadata: { source: "create-upload", fileName: name } }));
            setAttachments((current) => reconcileCreationAttachmentLimit([...current, attachment], [], maxReferences).attachments);
            toast.success(t("create.homePage.webImageAdded"));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : t("create.homePage.webImageFailed"));
        }
    };

    const handleLibrarySelect = async (selectedIds: string[], pickedItems = libraryItems) => {
        if (!requireLogin()) return;
        if (workspaceTeamId) {
            await loadAssetsForUse(selectedIds, { refresh: true });
            const byId = new Map(useAssetStore.getState().assets.map((asset) => [asset.id, asset]));
            const passages = selectedIds.map((id) => {
                const asset = byId.get(id);
                if (asset?.kind !== "text" || asset.status === "archived") throw new Error("请选择当前空间中未归档的文本素材");
                return asset.data.content;
            });
            setPrompt((current) => [current, ...passages].filter(Boolean).join("\n\n"));
            setLibraryOpen(false);
            return;
        }
        const next = creationLibrarySelectionToAttachments(selectedIds, pickedItems, mode, videoReferenceLimits);
        if (!next.length) return;
        const selected = new Set(selectedIds);
        const cachedIds = new Set(useAssetStore.getState().assets.map((asset) => asset.id));
        const uncachedAssetIds = pickedItems.filter((item) => item.asset && selected.has(item.id) && !cachedIds.has(item.id)).map((item) => item.id);
        if (uncachedAssetIds.length) await loadAssetsForUse(uncachedAssetIds);
        setAttachments((current) => {
            const candidates = [...current.filter((item) => !next.some((candidate) => candidate.id === item.id)), ...next];
            const reconciled = mode === "video" && videoReferenceLimits ? reconcileCreationAttachmentLimits(candidates, [], videoReferenceLimits) : reconcileCreationAttachmentLimit(candidates, [], maxReferences);
            if (reconciled.attachments.length < candidates.length) toast.warning(t("create.page.referenceLimitExceeded"));
            return reconciled.attachments;
        });
        setLibraryOpen(false);
    };

    const addDroppedReferences = async (drop: CreationReferenceDrop) => {
        if (!requireLogin() || busy || referenceReplacementBusy || referenceDropLock.current) return;
        const maxImages = mode === "video" ? videoReferenceLimits?.maxImages || 0 : maxReferences;
        const maxAttachments = mode === "video" ? Infinity : maxReferences;
        if (maxImages <= 0) {
            toast.warning("当前模型或模式不支持参考图");
            return;
        }
        const scope = getActiveUserScope();
        const conversationId = activeId;
        const active = () => scope === getActiveUserScope() && conversationId === activeIdRef.current;
        referenceDropLock.current = true;
        setReferenceDropBusy(true);
        try {
            if (drop.kind === "result") {
                const attachment = await creationAttachmentFromResult(
                    drop.image,
                    conversationsRef.current.flatMap((conversation) => conversation.messages),
                    useAssetStore.getState().assets,
                );
                if (!active()) return;
                const next = appendCreationReference(attachmentsRef.current, attachment, maxImages, maxAttachments);
                attachmentsRef.current = next;
                setAttachments(next);
                return;
            }
            const files = drop.files.filter((file) => file.type.startsWith("image/"));
            if (files.length !== drop.files.length) toast.warning("这里只能拖入图片文件");
            // 逐张上传，先检查容量；多文件保留原始顺序，失败不阻止后续合法图片。
            for (const file of files) {
                if (!active()) break;
                if (attachmentsRef.current.length >= maxAttachments || attachmentsRef.current.filter((item) => item.type.startsWith("image/")).length >= maxImages) {
                    toast.warning(t("create.page.referenceLimitExceeded"));
                    break;
                }
                try {
                    const { asset, attachment } = await uploadCreationAsset(file);
                    if (!active()) break;
                    if (asset) addAsset(asset);
                    const next = appendCreationReference(attachmentsRef.current, attachment, maxImages, maxAttachments);
                    attachmentsRef.current = next;
                    setAttachments(next);
                } catch (error) {
                    if (active()) toast.error(error instanceof Error ? error.message : "参考图上传失败");
                }
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "添加参考图失败");
        } finally {
            referenceDropLock.current = false;
            setReferenceDropBusy(false);
        }
    };

    const removeAttachment = (id: string) => {
        const reference = mentionReferences.find((item) => item.attachmentId === id);
        setAttachments((current) => removeCreationAttachment(current, id));
        if (reference) setPrompt((current) => removeCreationReferenceTokens(current, [reference]));
    };

    const clearAttachments = () => {
        const attachmentIds = new Set(attachments.map((item) => item.id));
        const references = mentionReferences.filter((item) => item.attachmentId && attachmentIds.has(item.attachmentId));
        setAttachments([]);
        if (references.length) setPrompt((current) => removeCreationReferenceTokens(current, references));
    };

    const clearComposer = () => {
        promptRef.current = "";
        attachmentsRef.current = [];
        setPrompt("");
        setAttachments([]);
        setDraftReferences([]);
        window.requestAnimationFrame(() => composerFocusRef.current?.focus());
    };

    const reorderAttachments = useCallback((next: CreationAttachment[]) => {
        attachmentsRef.current = next;
        setAttachments(next);
    }, []);

    const replaceAttachmentReference = useCallback((targetAttachmentId: string, replacement: CreationAttachment) => {
        const currentAttachments = attachmentsRef.current;
        const target = currentAttachments.find((attachment) => attachment.id === targetAttachmentId);
        if (!target) throw new Error(translate("create.page.replaceTargetMissing"));
        if (creationAttachmentKind(target) !== "image" || creationAttachmentKind(replacement) !== "image") throw new Error(translate("create.page.replaceImageOnly"));
        if (target.id === replacement.id) return false;

        const result = replaceCreationAttachmentReference(promptRef.current, currentAttachments, targetAttachmentId, replacement);
        promptRef.current = result.prompt;
        attachmentsRef.current = result.attachments;
        setPrompt(result.prompt);
        setAttachments(result.attachments);
        return true;
    }, []);

    const replaceReferenceFromTrack = useCallback(
        (targetAttachmentId: string, replacement: CreationAttachment) => {
            try {
                if (replaceAttachmentReference(targetAttachmentId, replacement)) toast.success(translate("create.page.referenceReplaced"));
            } catch (error) {
                toast.error(error instanceof Error ? error.message : translate("create.page.replaceFailed"));
            }
        },
        [replaceAttachmentReference, toast],
    );

    const replaceReferenceFromFiles = useCallback(
        async (targetAttachmentId: string, files: File[]) => {
            if (!requireLogin()) return;
            if (busy || referenceReplacementBusy) return;
            const file = files.find((item) => item.type.startsWith("image/"));
            if (!file) {
                toast.warning(translate("create.page.dropImageToReplace"));
                return;
            }
            setReferenceReplacementBusy(true);
            try {
                const { asset, attachment } = await uploadCreationAsset(file);
                if (creationAttachmentKind(attachment) !== "image") throw new Error(translate("create.page.uploadNotImage"));
                if (asset) addAsset(asset);
                if (replaceAttachmentReference(targetAttachmentId, attachment)) toast.success(translate("create.page.referenceReplaced"));
            } catch (error) {
                toast.error(error instanceof Error ? error.message : translate("create.page.uploadReplaceFailed"));
            } finally {
                setReferenceReplacementBusy(false);
            }
        },
        [addAsset, busy, referenceReplacementBusy, replaceAttachmentReference, requireLogin, toast],
    );

    const submit = async (retryContext?: CreationRetryContext, retryLockKey?: string) => {
        const releaseRetryLock = () => {
            if (retryLockKey) retryPreparingRef.current.delete(retryLockKey);
        };
        const submitToken = submitGateRef.current.tryAcquire();
        if (!submitToken) {
            // 以前这里是静默返回：上一条还在生成时点发送毫无反应，只能靠猜。
            releaseRetryLock();
            toast.warning(t("create.page.submitInProgress"));
            return;
        }
        const releaseSubmitGate = () => submitGateRef.current.release(submitToken);
        const text = prompt.trim();
        if (!text || busy || referenceReplacementBusy || referenceDropLock.current || !activeConversation) {
            releaseRetryLock();
            releaseSubmitGate();
            return;
        }
        if (!requireLogin()) {
            releaseRetryLock();
            releaseSubmitGate();
            return;
        }
        if (danceReplication && mode === "video" && !retryContext) {
            const { referenceImages, referenceVideos, referenceAudios } = splitCreationAttachments(attachments);
            if (referenceImages.length !== 1 || referenceVideos.length !== 1 || referenceAudios.length !== 0 || attachments.length !== 2) {
                toast.warning("请添加一张角色全身图和一段参考舞蹈视频");
                releaseRetryLock();
                releaseSubmitGate();
                return;
            }
            if (!selectedModel || modelCompatibilityError(config, selectedModel, modelRequirements)) {
                toast.warning("请选择同时支持参考图片和参考视频的模型");
                releaseRetryLock();
                releaseSubmitGate();
                return;
            }
        }
        if (!selectedModel) {
            toast.warning(t("create.page.configureModel", { mode: modeLabels[mode] }));
            releaseRetryLock();
            releaseSubmitGate();
            return;
        }
        const settingsError = mediaSettingIssues(generationConfig, mode, selectedModel)
            .map((item) => item.message)
            .join("；");
        if (settingsError) {
            toast.error(settingsError);
            releaseRetryLock();
            releaseSubmitGate();
            return;
        }
        if (mode === "video" && videoProfile.durationSupported !== false && !videoDurationAllowed(videoProfile, Number(generationConfig.videoSeconds))) {
            toast.error(t("create.page.durationUnsupported"));
            releaseRetryLock();
            releaseSubmitGate();
            return;
        }
        cheerYoru();
        const reconciledAttachments = mode === "video" && videoReferenceLimits ? reconcileCreationAttachmentLimits(attachments, mentionReferences, videoReferenceLimits) : reconcileCreationAttachmentLimit(attachments, mentionReferences, maxReferences);
        if (reconciledAttachments.attachments !== attachments) {
            toast.warning(t("create.page.referencesAdjusting"));
            releaseRetryLock();
            releaseSubmitGate();
            return;
        }
        const settings = { ratio, seconds, quality, videoQuality, count };
        const references = selectedCreationReferences(text, mentionReferences);
        // 后端对图片和视频使用不同的参考字段；这里先拆分，避免媒体类型在写入任务时被误判。
        const { referenceImages, referenceVideos, referenceAudios } = splitCreationAttachments(attachments);
        const videoOperation = inferVideoOperation({
            textCount: text ? 1 : 0,
            imageCount: referenceImages.length,
            videoCount: referenceVideos.length,
            audioCount: referenceAudios.length,
            characterCount: 0,
        });
        const skillReferences = hasSkillLibraryAccess() ? references.flatMap((reference) => (reference.skill ? [reference.skill] : [])) : [];
        let runtime: CreationRuntime;
        try {
            runtime = await loadCreationRuntime();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : t("create.page.runtimeLoadFailed"));
            releaseRetryLock();
            releaseSubmitGate();
            return;
        }
        let skillExecution: Awaited<ReturnType<typeof runtime.skillRuntime.prepare>>;
        try {
            skillExecution = await runtime.skillRuntime.prepare({
                profile: "creation",
                prompt: expandCreationPrompt(text, references, attachments),
                skills: skillReferences,
                selectedSkillIds: skillReferences.map((skill) => skill.skillId),
            });
        } catch (error) {
            toast.error(error instanceof Error ? error.message : t("create.page.skillContextFailed"));
            releaseRetryLock();
            releaseSubmitGate();
            return;
        }
        const expandedPrompt = skillExecution.prompt;
        const referenceMetadata = skillExecution.metadata;
        followLatestMessageRef.current = true;
        const userMessage = newMessage("user", text, { mode, model: selectedModel, attachments, references, settings });
        const assistantMessage = newMessage("assistant", "", { mode, model: selectedModel, status: mode === "text" && textStreaming ? "streaming" : "pending", generationStage: "提交中", settings, ...retryContext });
        const originConversationId = activeConversation.id;
        const updateOriginAssistant = (updater: (item: CreationMessage) => CreationMessage) => updateConversationMessage(originConversationId, assistantMessage.id, updater);
        const boundTaskIds = new Set<string>();
        const boundTaskIdsByBatchIndex = new Map<number, string>();
        const boundTasks = new Map<string, GenerationTask>();
        const bindTask = (task: GenerationTask) => {
            if (typeof task.clientContext?.batchIndex === "number") boundTaskIdsByBatchIndex.set(task.clientContext.batchIndex, task.id);
            boundTaskIds.add(task.id);
            activeGenerationTaskIdsRef.current.add(task.id);
            boundTasks.set(task.id, task);
            updateOriginAssistant((item) => ({
                ...item,
                generationStage: task.stage,
                generationStatus: task.status,
                generationMediaStage: task.mediaStage,
                generationPreviewUrls: Array.from(boundTasks.values())
                    .filter((value) => value.previewUrl && value.type === "canvas_image")
                    .map((value) => value.previewUrl!),
                generationImages: creationImageSlots(item, Array.from(boundTasks.values())),
                generationProgress: typeof task.progress === "number" && Number.isFinite(task.progress) ? Math.round(task.progress) : undefined,
                syncInterrupted: undefined,
                generationOperation: task.operation,
                generationErrorCode: task.errorCode,
                taskIds: Array.from(new Set([...(item.taskIds || []), task.id])),
                clientOperationId: task.clientOperationId,
                retryOf: task.retryOf,
                attemptGroupId: task.attemptGroupId,
            }));
            if (abortRef.current === controller) {
                abortRef.current = null;
                setBusy(false);
                // 任务已经建出来了：提交阶段到此结束。立刻放闸，这样上一条还在生成时
                // 也能继续提交下一条，不必等它跑完。
                releaseSubmitGate();
            }
        };
        updateActive((conversation) => ({
            ...conversation,
            title: conversation.messages.length ? conversation.title : text.slice(0, 24),
            updatedAt: new Date().toISOString(),
            messages: [...conversation.messages, userMessage, assistantMessage],
        }));
        setPrompt("");
        setAttachments([]);
        setDraftReferences([]);
        setDanceReplication(false);
        setBusy(true);
        const controller = new AbortController();
        const requestLifecycle = runtime.beginGenerationConsumer(controller.signal);
        abortRef.current = controller;
        const normalizedImage =
            mode === "image"
                ? imageProfile.parameters
                    ? { size: ratio, quality, imageResolution, imageParameters, count }
                    : { ...normalizeImageValue(imageProfile, { size: ratio, quality, imageResolution, imageParameters, count }, resolveModelRequestConfig(config, selectedModel).interfaceType), count }
                : undefined;
        const requestConfig = {
            ...generationConfig,
            model: selectedModel,
            imageModel: selectedModel,
            imageResolution: normalizedImage?.imageResolution || imageResolution,
            imageParameters: normalizedImage?.imageParameters || imageParameters,
            videoModel: selectedModel,
            textModel: selectedModel,
            ...(mode === "image" ? { size: normalizedImage?.size || ratio, quality: normalizedImage?.quality || quality, count: normalizedImage?.count || count, videoSeconds: config.videoSeconds } : {}),
        };
        let handedOverToRecovery = false;
        try {
            if (mode === "text") {
                const result = await runtime.runGenerationOperationOnce(retryContext?.clientOperationId, () =>
                    runtime.runBackendGenerationTask({
                        mode: "text",
                        prompt: expandedPrompt,
                        config: requestConfig,
                        referenceImages,
                        referenceVideos,
                        referenceAudios,
                        textHistory: (activeConversation.messages || []).filter((item) => item.content.trim()).map((item) => ({ role: item.role, content: item.content })),
                        signal: requestLifecycle.signal,
                        metadata: { source: "create-page", conversationId: activeConversation.id, messageId: assistantMessage.id, ...referenceMetadata },
                        onTaskUpdate: bindTask,
                        streamText: textStreaming,
                        thinkingLevel: textThinkingRequest,
                        onTextDelta: textStreaming ? (value) => updateOriginAssistant((item) => ({ ...item, content: value })) : undefined,
                        ...retryContext,
                    }),
                );
                if (!result.text?.trim()) throw new Error(t("create.page.noTextResult"));
                updateOriginAssistant((item) => ({ ...item, content: result.text || "", reasoning: result.reasoning }));
            } else if (mode === "image") {
                const taskCount = Math.max(1, Math.min(imageBatchLimit, Math.floor(Number(count) || 1)));
                const settled = await runtime.runGenerationOperationOnce(retryContext?.clientOperationId, () =>
                    runtime.runBackendGenerationTaskBatch({
                        mode: "image",
                        prompt: expandedPrompt,
                        config: { ...requestConfig, count: "1" },
                        referenceImages,
                        signal: requestLifecycle.signal,
                        metadata: { source: "create-page", conversationId: activeConversation.id, messageId: assistantMessage.id, ...referenceMetadata },
                        onTaskUpdate: bindTask,
                        count: taskCount,
                        ...retryContext,
                    }),
                );
                if (requestLifecycle.signal.aborted) throw new DOMException("Aborted", "AbortError");
                const boundTaskIdList = Array.from(boundTaskIds);
                const generatedTasks = settled.flatMap((entry, batchIndex) => {
                    if (entry.status !== "fulfilled") return [];
                    return [
                        {
                            result: entry.value,
                            taskId: boundTaskIdsByBatchIndex.get(batchIndex) || boundTaskIdList[batchIndex],
                            batchIndex,
                        },
                    ];
                });
                const previewImages = generatedTasks.flatMap(({ result }) => (result.images || []).filter((image) => Boolean(image.storageKey)));
                if (previewImages.length) {
                    updateOriginAssistant((item) => ({
                        ...item,
                        // Stable keys drive signed-URL resolution. Adding the
                        // temporary URL here and the materialized URL below
                        // renders one output twice until the next reload.
                        resultStorageKeys: Array.from(new Set([...(item.resultStorageKeys || []), ...previewImages.map((image) => image.storageKey!)])),
                    }));
                }
                const taskFailures = settled.filter((entry): entry is PromiseRejectedResult => entry.status === "rejected");
                const storedImages = await Promise.allSettled(
                    generatedTasks.map(async ({ result, taskId, batchIndex }) => {
                        if (!taskId) throw new Error(t("create.page.missingTaskId"));
                        const task = completedCreationGenerationTask(runtime, {
                            taskId,
                            task: boundTasks.get(taskId),
                            mode: "image",
                            prompt: expandedPrompt,
                            result,
                            conversationId: activeConversation.id,
                            messageId: assistantMessage.id,
                            batchIndex,
                            batchCount: taskCount,
                        });
                        const materialized = await runtime.consumeGenerationTaskMessage(
                            task,
                            assistantMessage.id,
                            async ({ resultUrls, resultStorageKeys, effectKey }) => {
                                await updateOriginAssistant(
                                    (item) =>
                                        runtime.applyGenerationConsumerEffect(item, effectKey, (current) => ({
                                            ...current,
                                            status: "done" as const,
                                            content: t("create.status.imageGenerated"),
                                            ...(resultUrls.length ? { resultUrls: Array.from(new Set([...(current.resultUrls || []), ...resultUrls])) } : {}),
                                            ...(resultStorageKeys.length ? { resultStorageKeys: Array.from(new Set([...(current.resultStorageKeys || []), ...resultStorageKeys])) } : {}),
                                        })).value,
                                );
                            },
                            { signal: requestLifecycle.signal },
                        );
                        const urls = runtime.generationTaskMaterializedUrls(materialized);
                        if (!urls.length) throw new Error(t("create.page.imageResultUnavailable"));
                        return urls;
                    }),
                );
                const resultUrls = storedImages.flatMap((entry) => (entry.status === "fulfilled" ? entry.value : []));
                const resourceFailures = storedImages.filter((entry): entry is PromiseRejectedResult => entry.status === "rejected");
                const failedCount = taskFailures.length + resourceFailures.length;
                if (!resultUrls.length) {
                    // 只要有一张图是“页面没跟上”而不是后端确认失败，就交给恢复监听继续跟进，而不是整条判失败。
                    const reasons = [...taskFailures, ...resourceFailures].map((entry) => entry.reason);
                    const reason = reasons.find((candidate) => !runtime.isGenerationTaskTerminalError(candidate)) ?? reasons[0];
                    throw reason instanceof Error ? reason : new Error(t("create.page.noImageResult"));
                }
                if (failedCount) toast.warning(t("create.page.imagesPartiallyGenerated", { done: resultUrls.length, failed: failedCount }));
                updateOriginAssistant((item) => ({ ...item, content: failedCount ? t("create.status.imagesPartiallyGenerated", { done: resultUrls.length, failed: failedCount }) : t("create.status.imageGenerated") }));
            } else {
                const result = await runtime.runGenerationOperationOnce(retryContext?.clientOperationId, () =>
                    runtime.runBackendGenerationTask({
                        mode: "video",
                        prompt: expandedPrompt,
                        config: requestConfig,
                        referenceImages,
                        referenceVideos,
                        referenceAudios,
                        signal: requestLifecycle.signal,
                        metadata: { source: "create-page", conversationId: activeConversation.id, messageId: assistantMessage.id, videoEditOperation: videoOperation, ...referenceMetadata },
                        onTaskUpdate: bindTask,
                        ...retryContext,
                    }),
                );
                if (!result.video?.dataUrl) throw new Error(t("create.page.noVideoResult"));
                const taskId = Array.from(boundTaskIds)[0];
                if (!taskId) throw new Error(t("create.page.missingTaskId"));
                const task = completedCreationGenerationTask(runtime, { taskId, task: boundTasks.get(taskId), mode: "video", prompt: expandedPrompt, result, conversationId: activeConversation.id, messageId: assistantMessage.id });
                const materialized = await runtime.consumeGenerationTaskMessage(
                    task,
                    assistantMessage.id,
                    async ({ resultUrls, resultStorageKeys, effectKey }) => {
                        await updateOriginAssistant(
                            (item) =>
                                runtime.applyGenerationConsumerEffect(item, effectKey, (current) => ({
                                    ...current,
                                    status: "done" as const,
                                    content: t("create.status.videoGenerated"),
                                    resultUrls,
                                    ...(resultStorageKeys.length ? { resultStorageKeys } : {}),
                                })).value,
                        );
                    },
                    { signal: requestLifecycle.signal },
                );
                const resultUrls = runtime.generationTaskMaterializedUrls(materialized);
                const resultStorageKeys = runtime.generationTaskMaterializedStorageKeys(materialized);
                if (!resultUrls.length && !resultStorageKeys.length) throw new Error(t("create.page.videoResultUnavailable"));
                updateOriginAssistant((item) => ({ ...item, status: "done", content: t("create.status.videoGenerated"), ...(resultUrls.length ? { resultUrls } : {}), ...(resultStorageKeys.length ? { resultStorageKeys } : {}) }));
            }
            updateOriginAssistant((item) => ({ ...item, status: "done" }));
        } catch (error) {
            // Once a task ID exists, a browser fetch/poll error is not proof that
            // the provider failed. The persisted task observer decides its final state.
            if (boundTaskIds.size) {
                const confirmedFailure = Array.from(boundTasks.values()).find((task) => task.status === "failed");
                if (confirmedFailure) {
                    updateOriginAssistant((item) => ({ ...item, status: "error", content: t("create.status.failed"), error: generationErrorMessage(confirmedFailure.error || error) }));
                    return;
                }
                updateOriginAssistant((item) => ({ ...item, status: "pending", content: t("create.homePage.syncingTask"), error: undefined }));
                toast.warning(t("create.homePage.connectionInterrupted"));
                return;
            }
            if (runtime.isGenerationTaskCancelled(error, requestLifecycle.signal)) {
                updateOriginAssistant((item) => ({ ...item, status: "cancelled", content: t("create.status.stopped") }));
                return;
            }
            if (boundTaskIds.size && !runtime.isGenerationTaskTerminalError(error)) {
                // 任务已在后端建立，只是页面没等到终态或没读到结果（轮询中断、网络抖动、结果下载失败）：
                // 这不是生成失败。交给恢复监听继续跟进原任务；默认引导重新生成会让用户再付一次费。
                handedOverToRecovery = true;
                console.warn("创作任务等待中断，转交恢复监听继续跟进原任务", error);
                updateOriginAssistant((item) => ({ ...item, status: "pending", syncInterrupted: true, error: undefined, errorKind: undefined, createdAt: assistantMessage.createdAt }));
                return;
            }
            const message = generationErrorMessage(error);
            const failedTask = runtime.isGenerationTaskTerminalError(error) ? error.task : undefined;
            updateOriginAssistant((item) => ({
                ...item,
                status: "error",
                error: message,
                errorKind: boundTaskIds.size ? "task" : undefined,
                mediaRecoverable: failedTask?.canRecoverMedia || undefined,
                generationStatus: failedTask?.status ?? item.generationStatus,
                generationErrorCode: item.generationErrorCode || generationErrorCode(error),
                generationOperation: item.generationOperation || (mode === "video" ? videoOperation : mode),
                createdAt: assistantMessage.createdAt,
                content: t("create.status.failed"),
            }));
        } finally {
            for (const taskId of boundTaskIds) activeGenerationTaskIdsRef.current.delete(taskId);
            if (boundTaskIds.size || handedOverToRecovery) setRecoveryEpoch((value) => value + 1);
            requestLifecycle.release();
            releaseRetryLock();
            releaseSubmitGate();
            if (abortRef.current === controller) {
                abortRef.current = null;
                setBusy(false);
            }
        }
    };

    useEffect(() => {
        if (!retrySequence) return;
        const pending = pendingRetryRef.current;
        if (!pending) return;
        pendingRetryRef.current = null;
        void submit(pending.context, pending.lockKey);
    }, [retrySequence]);

    const startNewConversation = () => {
        const next = newConversation();
        followLatestMessageRef.current = true;
        setConversations((current) => [next, ...current]);
        setActiveId(next.id);
        setPrompt("");
        setAttachments([]);
        setDraftReferences([]);
        setHistoryOpen(false);
    };

    const continueOnCanvas = async (selectedAssetIds?: string[]) => {
        if (!requireLogin()) return;
        if (!activeConversation || openingCanvasRef.current) return;
        openingCanvasRef.current = true;
        setOpeningCanvas(true);
        const scope = getActiveUserScope();
        const source = activeConversation;
        try {
            const assets = useAssetStore.getState().assets;
            const generatedAssetIds =
                selectedAssetIds ||
                source.messages.flatMap((item) => {
                    const resultStorageKeys = item.resultStorageKeys || [];
                    const resultUrls = item.resultUrls || [];
                    if (!resultStorageKeys.length && !resultUrls.length) return [];
                    const ids = creationResultAssetIds(assets, { messageId: item.id, taskIds: item.taskIds || [], resultUrls, resultStorageKeys });
                    if (ids.length !== Math.max(resultStorageKeys.length, resultUrls.length)) throw new Error(t("create.page.handoffAssetsPending"));
                    return ids;
                });
            const referenceKeys = new Set(source.messages.flatMap((item) => (item.attachments || []).map((attachment) => attachment.storageKey).filter(Boolean)));
            const referenceAssetIds = assets.filter((asset) => (asset.kind === "image" || asset.kind === "video") && asset.data.storageKey && referenceKeys.has(asset.data.storageKey)).map((asset) => asset.id);
            const assetIds = [...generatedAssetIds, ...referenceAssetIds];
            if (assetIds.length) await saveRemoteUserDataNow([]);
            const result = await continueCreationConversationOnCanvas(source);
            if (scope !== getActiveUserScope()) return;
            const next = updateCreationConversationSnapshot(conversationsRef.current, source.id, (item) => ({ ...item, canvasId: result.id }));
            conversationsRef.current = next;
            setConversations(next);
            await saveConversationHistory(next);
            if (scope !== getActiveUserScope()) return;
            if (result.syncError) toast.warning(t("create.page.handoffSyncPending"));
            const params = new URLSearchParams({ conversation: result.sessionId });
            if (assetIds.length) {
                params.set("mode", "handoff");
                [...new Set(assetIds)].forEach((id) => params.append("asset", id));
            }
            navigate(workspacePath(`/canvas/${result.id}?${params.toString()}`));
        } catch (cause) {
            if (scope === getActiveUserScope()) toast.error(cause instanceof Error ? cause.message : t("create.page.handoffFailed"));
        } finally {
            openingCanvasRef.current = false;
            setOpeningCanvas(false);
        }
    };

    const selectConversation = (conversation: CreationConversation) => {
        followLatestMessageRef.current = true;
        setActiveId(conversation.id);
        setPrompt("");
        setAttachments([]);
        setDraftReferences([]);
        setHistoryOpen(false);
    };

    const confirmDeleteConversation = (conversation: CreationConversation) => {
        const session = historySessionRef.current;
        const scope = getActiveUserScope();
        const title = conversation.title.trim() || t("create.conversation.untitled");
        const label = title.length > 32 ? `${title.slice(0, 32)}...` : title;
        modal.confirm({
            className: "workspace-modal workspace-modal-compact",
            title: t("create.page.deleteTitle"),
            content: t("create.page.deleteContent", { title: label }),
            okText: t("create.history.delete"),
            okButtonProps: { danger: true },
            cancelText: t("create.page.deleteKeep"),
            onOk: async () => {
                try {
                    if (!session || session !== historySessionRef.current || scope !== getActiveUserScope()) throw new Error("账号已切换");
                    const remaining = removeCreationConversationSnapshot(conversationsRef.current, conversation.id);
                    const sortedRemaining = [...remaining].sort((left, right) => conversationTimestamp(right.updatedAt) - conversationTimestamp(left.updatedAt));
                    const fallback = sortedRemaining.find((item) => item.messages.length > 0) || sortedRemaining[0] || newConversation();
                    const next = remaining.length ? remaining : [fallback];
                    await session.remove(conversation.id, next);
                    if (session !== historySessionRef.current || scope !== getActiveUserScope()) return;
                    void session.sync();
                    conversationsRef.current = next;
                    setConversations(next);
                    if (activeIdRef.current === conversation.id) {
                        followLatestMessageRef.current = true;
                        activeIdRef.current = fallback.id;
                        setActiveId(fallback.id);
                        setPrompt("");
                        setAttachments([]);
                        setDraftReferences([]);
                    }
                    toast.success(t("create.page.deleted"));
                } catch (error) {
                    toast.error(error instanceof Error ? error.message : t("create.page.deleteFailed"));
                    throw error;
                }
            },
        });
    };

    /** 删除对话并切到最近的另一段；侧栏确认后也走这里，避免页面内存状态与存储不一致。 */
    const deleteConversationNow = async (conversationId: string) => {
        const remaining = removeCreationConversationSnapshot(conversationsRef.current, conversationId);
        const sortedRemaining = [...remaining].sort((left, right) => conversationTimestamp(right.updatedAt) - conversationTimestamp(left.updatedAt));
        const fallback = sortedRemaining.find((item) => item.messages.length > 0) || sortedRemaining[0] || newConversation();
        const next = remaining.length ? remaining : [fallback];
        const session = historySessionRef.current;
        const scope = getActiveUserScope();
        if (!session) throw new Error("创作历史尚未就绪");
        await session.remove(conversationId, next);
        if (session !== historySessionRef.current || scope !== getActiveUserScope()) return;
        void session.sync();
        conversationsRef.current = next;
        setConversations(next);
        if (activeIdRef.current === conversationId) {
            followLatestMessageRef.current = true;
            activeIdRef.current = fallback.id;
            setActiveId(fallback.id);
            setPrompt("");
            setAttachments([]);
            setDraftReferences([]);
        }
    };

    const setConversationPinned = (conversationId: string, pinned: boolean) => {
        const next = updateCreationConversationSnapshot(conversationsRef.current, conversationId, (item) => ({ ...item, pinned }));
        conversationsRef.current = next;
        setConversations(next);
        void saveConversationHistory(next).catch((error) => toast.error(error instanceof Error ? error.message : t("create.homePage.pinFailed")));
    };

    // 侧栏「对话」的操作由这里接手，保证页面内存中的对话与存储一致。
    const conversationRequestRef = useRef<(request: CreationConversationRequest) => boolean>(() => false);
    conversationRequestRef.current = (request) => {
        if (!hydrated) return false;
        if (request.type === "new") {
            startNewConversation();
            return true;
        }
        const target = conversationsRef.current.find((item) => item.id === request.id);
        if (!target) return false;
        if (request.type === "open") selectConversation(target);
        else if (request.type === "rename") renameConversationTitle(target, request.title);
        else if (request.type === "pin") setConversationPinned(target.id, request.pinned);
        else {
            // 侧栏已完成确认；这里只执行删除，结果通过存储广播回侧栏。
            void deleteConversationNow(target.id).catch((error) => toast.error(error instanceof Error ? error.message : t("create.page.deleteFailed")));
        }
        return true;
    };
    useEffect(() => {
        const onRequest = (event: Event) => {
            if (conversationRequestRef.current((event as CustomEvent<CreationConversationRequest>).detail)) event.preventDefault();
        };
        window.addEventListener(CREATION_CONVERSATION_REQUEST_EVENT, onRequest);
        return () => window.removeEventListener(CREATION_CONVERSATION_REQUEST_EVENT, onRequest);
    }, []);
    useEffect(() => {
        if (hydrated && activeId) announceActiveCreationConversation(activeId);
    }, [activeId, hydrated]);
    useEffect(() => () => announceActiveCreationConversation(""), []);
    /**
     * 创作首页与对话是两个页面状态，由地址决定：
     *   /                     → 创作首页（空白新对话），侧栏高亮「创作」
     *   /?conversation=<id>   → 打开这段对话，侧栏高亮该对话
     * 首页里发出第一条消息后，地址自动换成该对话，之后点「创作」即可回到首页。
     */
    const requestedConversation = searchParams.get("conversation");
    const lastRequestedConversationRef = useRef<string | null | undefined>(undefined);
    const activeMessageCount = conversations.find((item) => item.id === activeId)?.messages.length || 0;
    const setConversationParam = (id: string | null) =>
        setSearchParams(
            (current) => {
                const next = new URLSearchParams(current);
                if (id) next.set("conversation", id);
                else next.delete("conversation");
                return next;
            },
            { replace: true },
        );
    useEffect(() => {
        if (!hydrated || !activeId) return;
        const changed = lastRequestedConversationRef.current !== requestedConversation;
        lastRequestedConversationRef.current = requestedConversation;
        const active = conversationsRef.current.find((item) => item.id === activeId);
        if (changed) {
            if (!requestedConversation || requestedConversation === "new") {
                const blank = active && !active.messages.length ? active : conversationsRef.current.find((item) => !item.messages.length);
                if (blank) {
                    if (blank.id !== activeId) selectConversation(blank);
                } else {
                    // 同步写入 ref，随后把地址换成新对话 ID 时能找到它。
                    const next = newConversation();
                    conversationsRef.current = [next, ...conversationsRef.current];
                    setConversations(conversationsRef.current);
                    followLatestMessageRef.current = true;
                    activeIdRef.current = next.id;
                    setActiveId(next.id);
                    setPrompt("");
                    setAttachments([]);
                    setDraftReferences([]);
                    if (requestedConversation === "new") lastRequestedConversationRef.current = next.id;
                    if (requestedConversation === "new") setConversationParam(next.id);
                    return;
                }
                // 新建对话：留在对话视图，地址指向这段空对话；回首页则不带对话参数。
                if (requestedConversation === "new") {
                    lastRequestedConversationRef.current = blank.id;
                    setConversationParam(blank.id);
                }
                return;
            }
            const target = conversationsRef.current.find((item) => item.id === requestedConversation);
            if (!target) {
                setConversationParam(null);
                return;
            }
            if (target.id !== activeId) selectConversation(target);
            return;
        }
        // 地址未变：当前对话有了内容（首页首条消息、历史抽屉切换、删除后回退）时同步到地址。
        if (active?.messages.length && requestedConversation !== activeId) setConversationParam(activeId);
        else if (requestedConversation && !conversationsRef.current.some((item) => item.id === requestedConversation)) setConversationParam(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hydrated, requestedConversation, activeId, activeMessageCount]);

    const renameConversationTitle = (conversation: CreationConversation, title: string) => {
        const nextTitle = title.trim().slice(0, 120);
        if (!nextTitle || nextTitle === conversation.title.trim()) return;
        const next = updateCreationConversationSnapshot(conversationsRef.current, conversation.id, (item) => ({ ...item, title: nextTitle }));
        conversationsRef.current = next;
        setConversations(next);
        void saveConversationHistory(next).catch((error) => toast.error(error instanceof Error ? error.message : t("create.page.renameFailed")));
    };

    const restoreMessageDraft = (item: CreationMessage) => {
        const nextMode = item.mode || "text";
        const nextSettings = item.settings;
        selectMode(nextMode);
        setPrompt(item.content);
        setAttachments(item.attachments ? [...item.attachments] : []);
        setDraftReferences(item.references ? [...item.references] : []);
        if (item.model) updateConfig(nextMode === "text" ? "textModel" : nextMode === "image" ? "imageModel" : "videoModel", item.model);
        if (!nextSettings) return;
        setRatio(nextSettings.ratio);
        setSeconds(nextSettings.seconds);
        setQuality(nextSettings.quality);
        setVideoQuality(nextSettings.videoQuality);
        setCount(nextSettings.count);
        if (nextMode === "image") rememberImageSettings({ ratio: nextSettings.ratio, quality: nextSettings.quality, count: nextSettings.count });
        if (nextMode === "video") rememberVideoSettings({ ratio: nextSettings.ratio, seconds: nextSettings.seconds, videoQuality: nextSettings.videoQuality });
    };

    const retryFailedMessage = async (item: CreationMessage, index: number) => {
        const previous = item.role === "assistant" ? activeConversation?.messages[index - 1] : item;
        if (!previous?.content || busy) return;
        const retryOf = item.taskIds?.[0];
        const restoreForRetry = () => {
            followLatestMessageRef.current = true;
            restoreMessageDraft(previous);
            const removedIds = new Set([item.id, previous.id]);
            if (activeConversation)
                void historySessionRef.current?.removeMessages(activeConversation.id, [...removedIds]).catch((error: unknown) => setHistorySync({ phase: "error", message: error instanceof Error ? error.message : "本地删除记录保存失败" }));
            updateActive((conversation) => {
                const messages = conversation.messages.filter((message) => !removedIds.has(message.id));
                const firstPrompt = messages.find((message) => message.role === "user")?.content.trim();
                return { ...conversation, title: firstPrompt ? firstPrompt.slice(0, 24) : t("create.conversation.untitled"), updatedAt: new Date().toISOString(), messages };
            });
        };
        if (!retryOf) {
            restoreForRetry();
            return;
        }
        if (retryPreparingRef.current.has(retryOf)) return;
        retryPreparingRef.current.add(retryOf);
        try {
            const runtime = await loadCreationRuntime();
            const attemptGroupId = item.attemptGroupId || item.retryOf || retryOf;
            const context: CreationRetryContext = {
                ...(await runtime.createGenerationRetryContext(retryOf, attemptGroupId)),
                ...(item.taskIds && item.taskIds.length > 1 ? { retryContextsByBatchIndex: await runtime.createGenerationBatchRetryContexts(item.taskIds, attemptGroupId) } : {}),
            };
            restoreForRetry();
            pendingRetryRef.current = { context, lockKey: retryOf };
            setRetrySequence((current) => current + 1);
        } catch (error) {
            retryPreparingRef.current.delete(retryOf);
            toast.error(generationErrorMessage(error));
        }
    };

    // 作品可能已经生成（页面只是没拿到结果，或仍在重连），或上游超时后费用不确定时，重新生成会提交新任务并再次扣费，先确认。
    const regenerateMessage = (item: CreationMessage, index: number) => {
        const resultMayExist = creationMessageNeedsResultSync(item) || Boolean(item.syncInterrupted && (item.status === "pending" || item.status === "streaming"));
        const costUncertain = item.status === "error" && isGenerationCostUncertainError(item.error);
        if (!resultMayExist && !costUncertain) {
            void retryFailedMessage(item, index);
            return;
        }
        modal.confirm({
            className: "workspace-modal workspace-modal-compact",
            title: t(resultMayExist ? "create.page.regenerateTitle" : "create.page.regenerateUncertainTitle"),
            content: t(resultMayExist ? "create.page.regenerateContent" : "create.page.regenerateUncertainContent"),
            okText: t("create.page.regenerateConfirm"),
            cancelText: t("create.page.regenerateCancel"),
            onOk: () => retryFailedMessage(item, index),
        });
    };

    const createVariant = (item: CreationMessage, index: number) => {
        const previous = item.role === "assistant" ? activeConversation?.messages[index - 1] : item;
        if (!previous?.content || busy) return;
        restoreMessageDraft(previous);
        window.requestAnimationFrame(() => composerFocusRef.current?.focus());
    };

    // 再次生成：按原提示词、参考与参数立即提交一批新的。等参数状态提交后再调用 submit，读到的是恢复后的值。
    const submitRef = useRef(submit);
    submitRef.current = submit;
    const regenerateBatch = (item: CreationMessage, index: number) => {
        const previous = item.role === "assistant" ? activeConversation?.messages[index - 1] : item;
        if (!previous?.content || busy) return;
        restoreMessageDraft(previous);
        window.setTimeout(() => void submitRef.current(), 80);
    };

    /** 删除一批结果：先彻底删除对应素材（含云端文件，经后端 Outbox 异步清理），再移除这轮对话消息。 */
    const deleteMessageBatch = async (item: CreationMessage, index: number, assetIds: string[]) => {
        const conversationId = activeIdRef.current;
        const conversation = conversationsRef.current.find((entry) => entry.id === conversationId);
        if (!conversation) throw new Error(t("create.homePage.conversationMissing"));
        const previous = conversation.messages[index - 1];
        const removedIds = [item.id, ...(previous?.role === "user" && conversation.messages[index + 1]?.role !== "assistant" ? [previous.id] : [])];
        try {
            if (assetIds.length) await deleteAssetsWithRemoteSync(assetIds);
            const next = updateCreationConversationSnapshot(conversationsRef.current, conversationId, (entry) => ({ ...entry, updatedAt: new Date().toISOString(), messages: entry.messages.filter((message) => !removedIds.includes(message.id)) }));
            conversationsRef.current = next;
            setConversations(next);
            const session = historySessionRef.current;
            if (!session) throw new Error("创作历史尚未就绪");
            await session.removeMessages(conversationId, removedIds);
            await saveConversationHistory(next);
            toast.success(t("create.homePage.batchDeleted"));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : t("create.homePage.batchDeleteFailed"));
            throw error;
        }
    };

    const useResultAsReference = (storageKey: string, url: string) => {
        if (!requireLogin()) return;
        const uploaded = { url, storageKey, width: 0, height: 0, bytes: 0, mimeType: "image/png" };
        const attachment = creationAttachmentFromImage(new File([], `${t("create.homePage.resultFileName")}.png`, { type: "image/png" }), uploaded);
        if (mode !== "image") selectMode("image");
        setAttachments((current) => {
            const reconciled = reconcileCreationAttachmentLimit([...current.filter((entry) => entry.id !== attachment.id), attachment], [], Math.max(1, maxReferences));
            if (!reconciled.attachments.some((entry) => entry.id === attachment.id)) toast.warning(t("create.homePage.referenceFull"));
            return reconciled.attachments;
        });
        toast.success(t("create.homePage.addedAsReference"));
        window.requestAnimationFrame(() => composerFocusRef.current?.focus());
    };

    if (!hydrated || !activeConversation)
        return (
            <div className="grid h-full place-items-center">
                <Spin />
            </div>
        );

    const handleThreadScroll = () => {
        const container = threadScrollRef.current;
        if (!container) return;
        followLatestMessageRef.current = container.scrollHeight - container.scrollTop - container.clientHeight <= 160;
        if (isEmpty) {
            // Keep the original editor in flow: changing its height here feeds
            // scroll anchoring back into this handler and causes flicker.
            const bottom = launchpadRef.current?.getBoundingClientRect().bottom;
            if (bottom === undefined) return;
            const containerTop = container.getBoundingClientRect().top;
            const remaining = bottom - containerTop;
            if (!inspirationSectionRef.current?.isConnected) inspirationSectionRef.current = container.querySelector<HTMLElement>(".inspiration-video-section");
            const inspirationTop = inspirationSectionRef.current?.getBoundingClientRect().top;
            const browsingVideos = inspirationTop !== undefined && inspirationTop <= containerTop + 96;
            if (remaining < -16) setLaunchpadCondensed(!browsingVideos);
            else if (remaining > 24 || container.scrollTop <= 24) setLaunchpadCondensed(false);
        }
    };

    const generationActive = activeConversation.messages.some((message) => message.role === "assistant" && message.status === "pending");
    const startPrompt = (nextMode: CreationMode, nextPrompt: string) => {
        setAudioMode(null);
        setHomeSurface("generate");
        selectMode(nextMode);
        setPrompt(nextPrompt);
        threadScrollRef.current?.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
        window.requestAnimationFrame(() => composerFocusRef.current?.focus({ preventScroll: true }));
    };

    const startDanceReplication = () => {
        if (danceReplication) {
            setDanceReplication(false);
            return;
        }
        if (!requireLogin()) return;
        const requirements: ModelRequirements = {
            capability: "video",
            input: { textCount: 1, imageCount: 1, videoCount: 1, audioCount: 0, characterCount: 0 },
        };
        const models = selectableModelsByCapability(config, "video");
        const model = [config.videoModel, ...models].find((option) => models.includes(option) && !modelCompatibilityError(config, option, requirements));
        if (!model) {
            toast.warning("请先配置同时支持参考图片和参考视频的视频模型");
            return;
        }
        startPrompt("video", "让参考角色图中的人物按照参考视频复现舞蹈动作和节奏，保持角色面部、发型、服装和体型一致。");
        updateConfig("videoModel", model);
        setDanceReplication(true);
    };

    const homeMode: HomeMode = audioMode ?? (mode === "text" ? "agent" : mode);
    const chooseHomeMode = (next: HomeMode) => {
        if (next === "music" || next === "audio") {
            if (!requireLogin()) return;
            setDanceReplication(false);
            setAudioMode(next);
            return;
        }
        setAudioMode(null);
        selectMode(next === "agent" ? "text" : next);
        window.requestAnimationFrame(() => composerFocusRef.current?.focus({ preventScroll: true }));
    };
    const insertPromptToken = (token: string) => {
        setPrompt((current) => `${current.trim() ? `${current.replace(/\s+$/, "")} ` : ""}${token} `);
        window.requestAnimationFrame(() => composerFocusRef.current?.focus({ preventScroll: true }));
    };
    // 技能快捷条可能推荐尚未添加的公开技能：先添加到“我的技能”，再以 @技能 引用写入提示词，交给技能运行时展开。
    const applyHomeSkill = async (skill: Skill) => {
        if (!requireLogin()) return;
        try {
            let target = skill;
            if (!skill.isAdded) {
                const { addSkill } = await import("@/services/api/skills");
                target = { ...(await addSkill(skill.skillId)).skill, isAdded: true };
            }
            setAddedSkills((current) => (current.some((item) => item.skillId === target.skillId) ? current : [...current, target]));
            const reference = buildSkillMentionReferences([target])[0];
            if (!reference) return;
            if (audioMode) setAudioMode(null);
            insertPromptToken(canvasResourceMentionToken(reference));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : t("create.homePage.skillAddFailed"));
        }
    };
    const homePlaceholder = mode === "text" ? t("create.homePage.placeholderAgent") : mode === "image" ? t("create.homePage.placeholderImage") : t("create.homePage.placeholderVideo");
    const homeModeMenu = <HomeModeMenu value={homeMode} onChange={chooseHomeMode} disabled={busy} />;
    const homeSkillControls = (
        <>
            <HomeSkillsButton
                skills={addedSkills}
                loading={Boolean(userId) && !addedSkills.length && addedSkillsRequestedRef.current}
                onOpen={() => {
                    if (requireLogin()) loadAddedSkills();
                }}
                onPick={(skill) => void applyHomeSkill(skill)}
                disabled={busy}
            />
            {audioMode ? null : (
                <HomeMentionButton
                    references={mentionReferences}
                    onPick={(reference) => insertPromptToken(canvasResourceMentionToken(reference))}
                    onCreateSubject={() => {
                        if (requireLogin()) setLibraryOpen(true);
                    }}
                    disabled={busy}
                />
            )}
        </>
    );

    const composerProps = {
        mode,
        prompt,
        setPrompt,
        busy,
        generationActive,
        referenceReplacementBusy,
        referenceDropBusy,
        onReferenceDrop: addDroppedReferences,
        attachments,
        referenceImageSize,
        maxReferences,
        references: mentionReferences,
        onRemoveAttachment: removeAttachment,
        onClearAttachments: clearAttachments,
        onClearComposer: clearComposer,
        onReorderAttachments: reorderAttachments,
        onReplaceAttachment: replaceReferenceFromTrack,
        onReplaceReferenceFiles: replaceReferenceFromFiles,
        onOpenLibrary: () => {
            if (requireLogin()) setLibraryOpen(true);
        },
        onModeChange: selectMode,
        model: selectedModel,
        modelRequirements,
        imageProfile,
        videoProfile,
        config: generationConfig,
        onModelChange: (value: string) => updateConfig(mode === "text" ? "textModel" : mode === "image" ? "imageModel" : "videoModel", value),
        ratio,
        setRatio: setComposerRatio,
        seconds,
        setSeconds: setComposerSeconds,
        quality,
        setQuality: setComposerQuality,
        imageResolution,
        setImageResolution: setComposerImageResolution,
        imageParameters,
        setImageParameters: (value: string) => {
            setImageParameters(value);
            rememberImageSettings({ model: selectedModel, imageParameters: value });
        },
        setTransparentBackground: (value: string) => useConfigStore.getState().updateConfig("transparentBackground", value),
        videoQuality,
        setVideoQuality: setComposerVideoQuality,
        count,
        setCount: setComposerCount,
        textStreaming,
        setTextStreaming,
        textThinkingLevels,
        textThinkingLevel,
        textThinkingRequest,
        setTextThinkingLevel,
        promptOptimizerProvider,
        composerFocusRef,
        onPromptFocus: loadAddedSkills,
        onSubmit: () => {
            if (prompt.trim() && !busy && !referenceReplacementBusy) trackSiteTrafficAction(mode === "text" ? "creation_submit_text" : mode === "image" ? "creation_submit_image" : "creation_submit_video");
            void submit();
        },
    };

    return (
        <>
            <div
                className="creation-home relative flex h-full min-h-0 flex-col overflow-hidden"
                onDragOver={(event: DragEvent<HTMLDivElement>) => {
                    if (!mightContainCreationImage(event.dataTransfer)) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "copy";
                    setDraggingImages(true);
                }}
                onDragLeave={(event: DragEvent<HTMLDivElement>) => {
                    const bounds = event.currentTarget.getBoundingClientRect();
                    if (event.clientX <= bounds.left || event.clientX >= bounds.right || event.clientY <= bounds.top || event.clientY >= bounds.bottom) setDraggingImages(false);
                }}
                onDrop={(event: DragEvent<HTMLDivElement>) => {
                    setDraggingImages(false);
                    if (event.defaultPrevented) return;
                    const source = readCreationImageTransfer(event.dataTransfer);
                    if (!source.files.length && !source.assetId && !source.url) return;
                    event.preventDefault();
                    void handleImageTransfer(event.dataTransfer);
                }}
                onPaste={(event) => {
                    const source = readCreationImageTransfer(event.clipboardData);
                    if (!source.files.length && !source.assetId && !source.url) return;
                    event.preventDefault();
                    void handleImageTransfer(event.clipboardData);
                }}
            >
                {conversationStorageError ? (
                    <p role="status" className="mx-auto mb-3 max-w-3xl px-4 text-xs text-foreground/55">
                        本地历史读取失败，当前会话仍保留。 {conversationStorageError}{" "}
                        <button
                            type="button"
                            className="underline underline-offset-2"
                            onClick={() => {
                                setConversationStorageError("");
                                setConversationLoadAttempt((attempt) => attempt + 1);
                            }}
                        >
                            重试
                        </button>
                    </p>
                ) : null}
                {draggingImages ? (
                    <div className="creation-image-drop-overlay" aria-hidden="true">
                        {t("create.homePage.dropToAddReference")}
                    </div>
                ) : null}
                {showHomeLaunchpad ? (
                    <>
                        <AnimatePresence>
                            {launchpadCondensed && homeSurface === "generate" && !audioMode ? (
                                <motion.div
                                    className="creation-floating-prompt"
                                    key="floating-prompt"
                                    style={{ x: "-50%" }}
                                    initial={{ opacity: 0, y: -12, scale: 0.97 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: -8, scale: 0.98 }}
                                    transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 360, damping: 32, mass: 0.8 }}
                                >
                                    <PenLine aria-hidden="true" />
                                    <input aria-label={t("create.page.quickEditLabel")} placeholder={t("create.page.quickEditPlaceholder")} value={prompt} disabled={busy || referenceReplacementBusy} onChange={(event) => setPrompt(event.target.value)} />
                                    <Tooltip title={t("create.page.expandComposer")}>
                                        <button
                                            type="button"
                                            aria-label={t("create.page.expandComposer")}
                                            onClick={() => {
                                                threadScrollRef.current?.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
                                                composerFocusRef.current?.focus({ preventScroll: true });
                                            }}
                                        >
                                            <Maximize2 />
                                        </button>
                                    </Tooltip>
                                </motion.div>
                            ) : null}
                        </AnimatePresence>
                        <main ref={threadScrollRef} onScroll={handleThreadScroll} className="creation-home-scroll creation-scrollbar">
                            <HomeAmbientBackdrop />
                            <section ref={launchpadRef} className="creation-launchpad home-launchpad" aria-label={t("create.page.launchpadLabel")}>
                                <header className="home-hero">
                                    <h1>
                                        {greetingName ? (
                                            <>
                                                <span className="home-hero-name">{greetingName}</span>
                                                <Trans i18nKey="create.homePage.heroAfterName" components={{ comma: <span className="home-hero-comma" />, em: <em /> }} />
                                            </>
                                        ) : (
                                            <Trans i18nKey="create.homePage.heroGuest" components={{ comma: <span className="home-hero-comma" />, em: <em /> }} />
                                        )}
                                    </h1>
                                    {/* 历史对话已移到左侧导航「对话」区 */}
                                </header>
                                <HomeSurfaceSwitch value={homeSurface} onChange={setHomeSurface} />
                                <AnimatePresence mode="wait" initial={false}>
                                    {homeSurface === "canvas" ? (
                                        <HomeCanvasPanel key="canvas" onRequireLogin={() => setLoginDialogOpen(true)} />
                                    ) : (
                                        <motion.div
                                            key="generate"
                                            className="home-generate-panel"
                                            initial={reducedMotion ? false : { opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: -6 }}
                                            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                                        >
                                            {audioMode ? (
                                                <HomeAudioComposer
                                                    kind={audioMode}
                                                    config={config}
                                                    userId={userId}
                                                    onRequireLogin={requireLogin}
                                                    onConfigChange={(key, value) => updateConfig(key, value)}
                                                    modeMenu={homeModeMenu}
                                                    trailingControls={homeSkillControls}
                                                />
                                            ) : (
                                                <div className="creation-empty-composer">
                                                    <CreationComposer {...composerProps} variant="empty" placeholderOverride={homePlaceholder} home={{ modeMenu: homeModeMenu, trailingControls: homeSkillControls }} />
                                                </div>
                                            )}
                                            {!workspaceTeamId && (
                                                <div className="flex flex-wrap items-center justify-center gap-2">
                                                    <button type="button" className="home-skill-chip" aria-pressed={danceReplication} disabled={busy} onClick={startDanceReplication}>
                                                        跳舞复刻
                                                    </button>
                                                    {danceReplication && <span className="text-xs text-muted-foreground" role="status">添加一张角色全身图和一段参考舞蹈视频</span>}
                                                </div>
                                            )}
                                            <HomeSkillChips userId={userId} onApply={(skill) => void applyHomeSkill(skill)} />
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </section>
                            <HomeFeatureShowcase
                                brandName={brandName}
                                onOpen={(to) => {
                                    if (requireLogin()) navigate(to);
                                }}
                            />
                            {/* 作品分类区：数据来自 public/home-gallery.json，暂无作品时各分类显示空状态。 */}
                            <HomeGallery
                                onUse={(item) => {
                                    if (item.prompt) startPrompt(item.mode || "image", item.prompt);
                                }}
                            />
                        </main>
                    </>
                ) : (
                    <div className="creation-thread-workbench">
                        <CreationWorkspaceToolbar
                            onNewConversation={startNewConversation}
                            onOpenHistory={() => setHistoryOpen(true)}
                            shots={videoShots}
                            onJumpToShot={jumpToShot}
                            onContinueCanvas={() => void continueOnCanvas()}
                            openingCanvas={openingCanvas}
                        />
                        <main ref={threadScrollRef} onScroll={handleThreadScroll} className="creation-thread-scroll creation-scrollbar">
                            {isEmpty ? (
                                <CreationBlankConversation
                                    greetingName={greetingName}
                                    onTry={(nextMode, nextPrompt) => {
                                        selectMode(nextMode);
                                        setPrompt(nextPrompt);
                                        window.requestAnimationFrame(() => composerFocusRef.current?.focus());
                                    }}
                                />
                            ) : null}
                            <section className="creation-thread-stage">
                                <div className="creation-results">
                                    {activeConversation.messages.map((item, index) => (
                                        <div key={item.id} id={`creation-shot-${item.id}`} className="creation-thread-message">
                                            <CreationMessageView
                                                item={item}
                                                shotNumber={creationVideoShotOrdinal(videoShots, item)}
                                                onRetryFailure={() => regenerateMessage(item, index)}
                                                onRefreshResult={() => void refreshMessageResult(item)}
                                                onRecoverMedia={() => void recoverMessageMedia(item)}
                                                refreshingResult={resultRefreshIds.has(item.id)}
                                                onCreateVariant={() => createVariant(item, index)}
                                                onContinueCanvas={(ids) => void continueOnCanvas(ids)}
                                                openingCanvas={openingCanvas}
                                                onEditUserMessage={(text) => {
                                                    setPrompt(text);
                                                    window.requestAnimationFrame(() => composerFocusRef.current?.focus());
                                                }}
                                                batch={
                                                    item.role === "assistant" && item.mode !== "text" && item.status === "done"
                                                        ? {
                                                              prompt: displayCreationPrompt(activeConversation.messages[index - 1]?.content || "", activeConversation.messages[index - 1]?.references || []),
                                                              onEditAgain: () => createVariant(item, index),
                                                              onRegenerate: () => regenerateBatch(item, index),
                                                              onDelete: (assetIds) => deleteMessageBatch(item, index, assetIds),
                                                              onUseAsReference: useResultAsReference,
                                                          }
                                                        : undefined
                                                }
                                            />
                                        </div>
                                    ))}
                                </div>
                            </section>
                        </main>
                        <section className="creation-thread-composer is-home">
                            <CreationComposer
                                {...composerProps}
                                variant="thread"
                                placeholderOverride={homePlaceholder}
                                home={{
                                    modeMenu: <HomeModeMenu value={homeMode === "music" || homeMode === "audio" ? "agent" : homeMode} onChange={(next) => chooseHomeMode(next === "music" || next === "audio" ? "agent" : next)} disabled={busy} thread />,
                                    trailingControls: homeSkillControls,
                                }}
                            />
                        </section>
                    </div>
                )}
            </div>
            <CreationHistoryDrawer
                open={historyVisible}
                conversations={historyConversations}
                activeId={activeConversation.id}
                onNew={() => {
                    startNewConversation();
                    closeHistory();
                }}
                onClose={closeHistory}
                onSelect={(conversation) => {
                    selectConversation(conversation);
                    closeHistory();
                }}
                onDelete={confirmDeleteConversation}
                onRename={renameConversationTitle}
                syncStatus={
                    historyVisible ? (
                        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground/70">
                            <span role="status">
                                {t(`create.historySync.${historySync.phase}`, { count: historySync.deferredCount })}
                                {historySync.message ? ` · ${historySync.message}` : ""}
                            </span>
                            {historySync.phase === "error" || historySync.phase === "partial" ? (
                                <button
                                    type="button"
                                    className="underline underline-offset-2"
                                    onClick={() => {
                                        const session = historySessionRef.current;
                                        if (!session) return;
                                        setHistorySync((status) => ({ ...status, phase: "pending", message: undefined }));
                                        void session.sync(true);
                                    }}
                                >
                                    {t("create.historySync.retry")}
                                </button>
                            ) : null}
                            <CreationHistoryConflicts key={activeConversationScope} session={historySessionRef.current} status={historySync} busy={busy} />
                        </div>
                    ) : null
                }
            />
            <CreationLoginDialog open={loginDialogOpen} onClose={() => setLoginDialogOpen(false)} />
            {libraryOpen && userId ? (
                <Suspense fallback={null}>
                    <AssetLibraryPickerModal
                        remoteLibrary
                        remoteKind={workspaceTeamId ? "text" : undefined}
                        confirmLabel={workspaceTeamId ? (count) => `插入文本（${count}）` : undefined}
                        acceptRemoteItems
                        remoteItemDisabledReason={(asset) => creationLibraryDisabledReason(mode, asset.kind, videoReferenceLimits, Boolean(workspaceTeamId))}
                        open={libraryOpen}
                        items={libraryItems}
                        categoryLabels={{ ...creationAssetCategoryLabels, ...externalAssetSources.categoryLabels }}
                        folders={externalAssetSources.folders}
                        initialSelectedIds={attachments.flatMap((item) => (item.id.startsWith("asset:") ? [item.id.slice(6)] : item.id.startsWith("external:") ? [item.id] : []))}
                        upload={
                            workspaceTeamId
                                ? undefined
                                : {
                                      accept: creationUploadAccept(mode),
                                      description: mode === "text" ? t("create.page.uploadHintText") : mode === "video" ? t("create.page.uploadHintVideo") : t("create.page.uploadHintImage"),
                                      onUpload: uploadLibraryAssets,
                                      external: {
                                          accept: "image/*",
                                          description: t("create.page.uploadHintEagle"),
                                          onUpload: (files, folderId) => {
                                              if (!requireLogin()) return Promise.resolve([]);
                                              return externalAssetSources.uploadExternalFiles(files, folderId);
                                          },
                                      },
                                  }
                        }
                        onClose={() => setLibraryOpen(false)}
                        onConfirm={handleLibrarySelect}
                    />
                </Suspense>
            ) : null}
        </>
    );
}
