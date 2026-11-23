import { App, Button, Form, Input, Modal, Upload, type UploadFile } from "antd";
import { Select } from "@/components/ui/base/select";
import { Switch } from "@/components/ui/base/switch";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { FileArchive, FileText, GitBranch, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { fallbackSkillCategories } from "@/pages/skills/skill-catalog";
import { useSkillCuration } from "@/components/skills/skill-curation-browser";
import { discoverGitHubSkills, installGitHubSkill, installSkillUpload, type GitHubSkillDiscovery, type Skill } from "@/services/api/skills";

type InstallMode = "markdown" | "zip" | "github";

type InstallFormValues = {
    name?: string;
    description?: string;
    tag: string;
    is_public: boolean;
    url?: string;
    ref?: string;
    subdir?: string;
    autoUpdate: boolean;
};

const modeOptions = [
    { value: "markdown", label: <span className="inline-flex items-center gap-2"><FileText className="size-3.5" />Markdown</span> },
    { value: "zip", label: <span className="inline-flex items-center gap-2"><FileArchive className="size-3.5" />ZIP 技能包</span> },
    { value: "github", label: <span className="inline-flex items-center gap-2"><GitBranch className="size-3.5" />GitHub</span> },
];

export function SkillInstallModal({ open, onClose, onInstalled, onManualCreate }: { open: boolean; onClose: () => void; onInstalled: (skill: Skill) => void; onManualCreate: () => void }) {
    const { message } = App.useApp();
    const { curation, error: curationError, retry: retryCuration } = useSkillCuration(open);
    const [form] = Form.useForm<InstallFormValues>();
    const [mode, setMode] = useState<InstallMode>("markdown");
    const [fileList, setFileList] = useState<UploadFile[]>([]);
    const [phase, setPhase] = useState<"discovering" | "installing" | null>(null);
    const [discovery, setDiscovery] = useState<GitHubSkillDiscovery | null>(null);
    const pendingRequest = useRef<AbortController | null>(null);
    const installing = phase === "installing";
    const rootOptions = curation?.enabled
        ? (curation.roots || []).filter((root) => root.enabled && root.id !== "__unassigned__").map((root) => ({ value: root.id, label: root.name }))
        : fallbackSkillCategories;

    useEffect(() => {
        pendingRequest.current?.abort();
        pendingRequest.current = null;
        setPhase(null);
        setDiscovery(null);
        if (!open) return;
        setMode("markdown");
        setFileList([]);
        form.setFieldsValue({ tag: "", is_public: true, autoUpdate: true, name: "", description: "", url: "", ref: "", subdir: "" });
        return () => {
            pendingRequest.current?.abort();
            pendingRequest.current = null;
        };
    }, [form, open]);

    const clearDiscovery = () => {
        pendingRequest.current?.abort();
        pendingRequest.current = null;
        setPhase(null);
        if (discovery) form.setFieldValue("subdir", "");
        setDiscovery(null);
    };

    const close = () => {
        if (installing) return;
        clearDiscovery();
        onClose();
    };

    const install = async () => {
        if (pendingRequest.current) return;
        const controller = new AbortController();
        pendingRequest.current = controller;
        const isCurrent = () => pendingRequest.current === controller && !controller.signal.aborted;
        try {
            let values: InstallFormValues;
            try {
                values = await form.validateFields();
            } catch {
                return;
            }
            if (!isCurrent()) return;
            if (curationError || !curation) {
                message.error("平台分类尚未加载，请重试");
                return;
            }
            const platformRootId = curation.enabled ? values.tag : undefined;
            const tag = fallbackSkillCategories.some((category) => category.value === values.tag) ? values.tag : "others";
            const file = fileList[0]?.originFileObj;
            if (mode !== "github" && !file) {
                message.warning(`请选择一个 ${mode === "zip" ? "ZIP 技能包" : "Markdown 文件"}`);
                return;
            }
            setPhase(mode === "github" && !values.subdir?.trim() ? "discovering" : "installing");
            let githubSource = {
                url: discovery?.sourceUrl || values.url?.trim() || "",
                ref: values.ref?.trim() || discovery?.sourceRef || undefined,
                subdir: values.subdir?.trim() || undefined,
            };
            if (mode === "github" && !githubSource.subdir) {
                const found = await discoverGitHubSkills({ url: githubSource.url, ref: githubSource.ref }, controller.signal);
                if (!isCurrent()) return;
                if (found.skills.length === 0) throw new Error("仓库中未找到包含 SKILL.md 的技能目录");
                setDiscovery(found);
                if (found.skills.length > 1) {
                    message.info(`找到 ${found.skills.length} 个技能，请选择要安装的技能目录`);
                    return;
                }
                githubSource = { url: found.sourceUrl, ref: values.ref?.trim() || found.sourceRef, subdir: found.skills[0].subdir || undefined };
                form.setFieldValue("subdir", found.skills[0].subdir || "");
            }
            setPhase("installing");
            const result = mode === "github"
                ? await installGitHubSkill({
                    ...githubSource,
                    tag,
                    platformRootId,
                    isPrivate: !values.is_public,
                    autoUpdate: values.autoUpdate,
                })
                : await installSkillUpload({
                    file: file as File,
                    sourceType: mode,
                    name: values.name || undefined,
                    description: values.description || undefined,
                    tag,
                    platformRootId,
                    isPrivate: !values.is_public,
                });
            if (!isCurrent()) return;
            message.success("技能已安装");
            onInstalled(result.skill);
        } catch (error) {
            if (!isCurrent()) return;
            message.error(error instanceof Error ? error.message : "技能安装失败");
        } finally {
            if (pendingRequest.current === controller) {
                pendingRequest.current = null;
                setPhase(null);
            }
        }
    };

    return (
        <Modal
            className="skill-install-modal"
            open={open}
            width={680}
            destroyOnHidden
            mask={{ closable: !installing }}
            title="安装技能"
            onCancel={close}
            footer={(
                <div className="flex items-center justify-between gap-3">
                    <Button type="text" disabled={installing} onClick={() => { clearDiscovery(); onManualCreate(); }}>从空白创建单文件技能</Button>
                    <div className="flex gap-2"><Button disabled={installing} onClick={close}>取消</Button><Button type="primary" loading={phase !== null} onClick={() => void install()}>{phase === "discovering" ? "识别技能目录" : "安装技能"}</Button></div>
                </div>
            )}
        >
            <p className="mb-4 text-sm leading-6 text-foreground/55">支持标准 <code>SKILL.md</code>、包含多层目录的 ZIP 技能包，或公开 GitHub 仓库。名称和简介会优先从技能入口自动读取。</p>
<SegmentedControl className="skill-install-mode" block options={modeOptions} value={mode} disabled={installing} onChange={(value) => { clearDiscovery(); setMode(value as InstallMode); setFileList([]); }} />

            <Form form={form} layout="vertical" requiredMark="optional" disabled={installing} className="skill-install-form" onValuesChange={(changed) => {
                if ("url" in changed || "ref" in changed) clearDiscovery();
                else if (pendingRequest.current && !installing) clearDiscovery();
            }}>
                {mode === "github" ? (
                    <>
                        <Form.Item name="url" label="GitHub 地址" rules={[{ required: true, message: "请填写 GitHub 仓库地址" }, { type: "url", message: "请输入有效链接" }]}>
                            <Input type="url" inputMode="url" spellCheck={false} prefix={<GitBranch className="size-4 text-foreground/35" />} placeholder="https://github.com/owner/repository" />
                        </Form.Item>
                        <div className="grid gap-x-3 sm:grid-cols-2">
                            <Form.Item name="ref" label="分支或标签" extra="留空时使用默认分支"><Input spellCheck={false} placeholder="main" /></Form.Item>
                            <Form.Item name="subdir" label="技能子目录" rules={discovery && discovery.skills.length > 1 ? [{ required: true, message: "请选择要安装的技能目录" }] : undefined} extra={discovery && discovery.skills.length > 1 ? `仓库包含 ${discovery.skills.length} 个技能，请选择本次要安装的一个。` : "留空时自动识别；技能合集会列出可安装的目录。"}>
                                {discovery && discovery.skills.length > 1 ? (
                                    <Select showSearch={{ optionFilterProp: "label" }} placeholder="请选择要安装的技能" options={discovery.skills.map((skill) => ({ value: skill.subdir, label: skill.subdir || `${skill.name}（仓库根目录）` }))} />
                                ) : <Input spellCheck={false} placeholder="skills/ai-director" />}
                            </Form.Item>
                        </div>
                    </>
                ) : (
                    <>
                        <Upload.Dragger
                            accept={mode === "zip" ? ".zip,application/zip" : ".md,.markdown,text/markdown"}
                            maxCount={1}
                            fileList={fileList}
                            beforeUpload={(file) => {
                                if (file.size > 20 * 1024 * 1024) {
                                    message.error("技能文件不能超过 20MB");
                                    return Upload.LIST_IGNORE;
                                }
                                return false;
                            }}
                            onChange={({ fileList: next }) => setFileList(next.slice(-1))}
                            onRemove={() => { setFileList([]); return true; }}
                        >
                            <UploadCloud className="mx-auto mb-3 size-8 text-foreground/38" />
                            <div className="text-sm font-medium">拖入或选择 {mode === "zip" ? "ZIP 技能包" : "Markdown 文件"}</div>
                            <div className="mt-1 text-xs text-foreground/45">{mode === "zip" ? "根目录或唯一子目录中必须包含 SKILL.md" : "普通 .md 会作为技能入口 SKILL.md 安装"}</div>
                        </Upload.Dragger>
                        <div className="mt-4 grid gap-x-3 sm:grid-cols-2">
                            <Form.Item name="name" label="覆盖名称" extra="可选，留空时自动读取"><Input maxLength={80} autoComplete="off" /></Form.Item>
                            <Form.Item name="description" label="覆盖简介" extra="可选，留空时自动读取"><Input maxLength={500} autoComplete="off" /></Form.Item>
                        </div>
                    </>
                )}

                <div className="grid gap-x-3 sm:grid-cols-2">
                    <Form.Item name="tag" label="技能广场分类" rules={[{ required: true, message: "请选择技能分类" }]}>
                        <Select options={rootOptions} placeholder={curation ? "请选择分类" : "正在加载分类"} disabled={!curation || Boolean(curationError)} />
                    </Form.Item>
                    <Form.Item name="is_public" label="公开状态" valuePropName="checked" extra="公开后其他用户可以加入使用。">
                        <Switch checkedChildren="公开" unCheckedChildren="私有" />
                    </Form.Item>
                </div>
                {curationError ? <Button type="link" onClick={retryCuration}>分类加载失败，重试</Button> : null}
                {mode === "github" ? <Form.Item name="autoUpdate" label="自动同步" valuePropName="checked" extra="后台每 6 小时检查一次提交版本，并记录最近检查与同步时间。"><Switch checkedChildren="开启" unCheckedChildren="关闭" /></Form.Item> : null}
            </Form>
        </Modal>
    );
}
