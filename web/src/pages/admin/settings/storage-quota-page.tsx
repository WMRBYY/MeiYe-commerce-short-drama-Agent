import { App, Button, Form, Input, InputNumber, Modal, Select, Skeleton, Spin } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";

import { formatStorageCapacity, formatStorageDate } from "@/lib/account-storage-usage";
import { listAdminUsers, type AdminUser } from "@/services/api/auth";
import { getAdminStorageQuota, setAdminUserStorageQuota, updateAdminDefaultStorageQuota, type AdminStorageQuotaOverview, type UserStorageQuotaOverride } from "@/services/api/storage-grants";

import { AdminPageFrame } from "../components/admin-shell";
import { AdminDataTable, AdminTableEmpty } from "../components/admin-ui";

const GB = 1024 ** 3;

type OverrideFormValues = { userId: string; storageGB: number; note?: string };

/** 存储容量：全站默认基础容量 + 单个用户的基础容量。赠送与购买的扩容仍在用户基础容量之上累加。 */
export default function StorageQuotaPage() {
    const { message, modal } = App.useApp();
    const [data, setData] = useState<AdminStorageQuotaOverview | null>(null);
    const [loading, setLoading] = useState(false);
    const [defaultGB, setDefaultGB] = useState<number | null>(null);
    const [savingDefault, setSavingDefault] = useState(false);
    const [editing, setEditing] = useState<{ user?: UserStorageQuotaOverride } | null>(null);

    const load = async () => {
        setLoading(true);
        try {
            const next = await getAdminStorageQuota();
            setData(next);
            setDefaultGB(next.defaultStoredFileGB);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取存储容量设置失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, []);

    const saveDefault = async () => {
        if (!data || defaultGB == null) return;
        if (defaultGB === data.defaultStoredFileGB) return;
        modal.confirm({
            title: `把所有用户的默认容量改为 ${defaultGB} GB？`,
            content: "只影响没有单独设置容量的用户。容量调小后，已用超出新容量的用户不能再上传或生成，7 天宽限期后进入只读，已有文件不会被删除。",
            okText: "确认修改",
            onOk: async () => {
                setSavingDefault(true);
                try {
                    const next = await updateAdminDefaultStorageQuota(defaultGB);
                    setData(next);
                    setDefaultGB(next.defaultStoredFileGB);
                    message.success("默认容量已更新");
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "保存默认容量失败");
                    throw error;
                } finally {
                    setSavingDefault(false);
                }
            },
        });
    };

    const restore = (item: UserStorageQuotaOverride) => {
        modal.confirm({
            title: `恢复 ${item.displayName || item.username} 的默认容量？`,
            content: `恢复后基础容量变为全站默认 ${data?.defaultStoredFileGB ?? "--"} GB，赠送和购买的扩容保留。`,
            okText: "恢复默认",
            onOk: async () => {
                await setAdminUserStorageQuota(item.userId, null);
                message.success("已恢复默认容量");
                await load();
            },
        });
    };

    return (
        <AdminPageFrame title="存储容量" description="设置所有用户的默认文件存储容量，也可以为单个用户单独调整。" scroll>
            {loading && !data ? (
                <Skeleton active paragraph={{ rows: 8 }} />
            ) : (
                <div className="space-y-6">
                    <section className="rounded-md border border-border p-5">
                        <h2 className="mb-1 text-base font-semibold">全站默认容量</h2>
                        <p className="mb-4 text-sm text-foreground/60">所有没有单独设置容量的用户都使用这个值（不含赠送和购买的扩容）。</p>
                        <div className="flex flex-wrap items-center gap-3">
                            <InputNumber min={1} max={data?.maxDefaultGB ?? 999} precision={0} value={defaultGB ?? undefined} onChange={(value) => setDefaultGB(typeof value === "number" ? value : null)} addonAfter="GB" style={{ width: 200 }} />
                            <Button type="primary" loading={savingDefault} disabled={!data || defaultGB == null || defaultGB === data.defaultStoredFileGB} onClick={() => void saveDefault()}>
                                保存
                            </Button>
                            {data ? <span className="text-xs text-foreground/50">当前：{data.defaultStoredFileGB} GB，可设 1–{data.maxDefaultGB} GB</span> : null}
                        </div>
                    </section>

                    <section className="rounded-md border border-border p-5">
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <h2 className="mb-1 text-base font-semibold">单独设置的用户</h2>
                                <p className="text-sm text-foreground/60">这些用户的基础容量不跟随全站默认值；赠送和购买的扩容仍会累加。</p>
                            </div>
                            <Button type="primary" onClick={() => setEditing({})}>
                                为用户设置容量
                            </Button>
                        </div>
                        <AdminDataTable
                            table={{
                                rowKey: "userId",
                                size: "small",
                                loading,
                                dataSource: data?.overrides || [],
                                pagination: false,
                                columns: [
                                    { title: "用户", key: "user", ellipsis: true, render: (_, item) => <span>{item.displayName || item.username}<span className="ml-2 text-xs text-foreground/50">{item.username}</span></span> },
                                    { title: "基础容量", dataIndex: "baseBytes", width: 120, align: "right", render: (value) => formatStorageCapacity(value) },
                                    { title: "已用 / 总容量", key: "usage", width: 180, align: "right", render: (_, item) => <span className={item.usedBytes > item.totalBytes ? "text-status-error" : ""}>{formatStorageCapacity(item.usedBytes)} / {formatStorageCapacity(item.totalBytes)}</span> },
                                    { title: "备注", dataIndex: "note", ellipsis: true, render: (value) => value || "--" },
                                    { title: "更新时间", dataIndex: "updatedAt", width: 150, render: (value) => formatStorageDate(value) },
                                    {
                                        title: "操作",
                                        key: "actions",
                                        width: 160,
                                        align: "center",
                                        render: (_, item) => (
                                            <div className="flex justify-center gap-2">
                                                <Button size="small" onClick={() => setEditing({ user: item })}>
                                                    修改
                                                </Button>
                                                <Button size="small" onClick={() => restore(item)}>
                                                    恢复默认
                                                </Button>
                                            </div>
                                        ),
                                    },
                                ],
                                scroll: { x: 860 },
                            }}
                            empty={<AdminTableEmpty title="还没有单独设置容量的用户" description="点击右上角为某个用户设置容量" />}
                        />
                    </section>
                </div>
            )}
            {editing ? <UserQuotaModal current={editing.user} defaultGB={data?.defaultStoredFileGB} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} /> : null}
        </AdminPageFrame>
    );
}

function UserQuotaModal({ current, defaultGB, onClose, onSaved }: { current?: UserStorageQuotaOverride; defaultGB?: number; onClose: () => void; onSaved: () => void }) {
    const { message } = App.useApp();
    const [form] = Form.useForm<OverrideFormValues>();
    const [saving, setSaving] = useState(false);
    const [options, setOptions] = useState<AdminUser[]>([]);
    const [searching, setSearching] = useState(false);
    const searchSeq = useRef(0);

    useEffect(() => {
        form.setFieldsValue(current ? { userId: current.userId, storageGB: Number((current.baseBytes / GB).toFixed(2)), note: current.note } : { storageGB: defaultGB ?? 5, note: "" });
    }, [current]);

    const search = async (keyword: string) => {
        const seq = ++searchSeq.current;
        setSearching(true);
        try {
            const result = await listAdminUsers({ keyword: keyword.trim() || undefined, page: 1, pageSize: 20 });
            if (seq === searchSeq.current) setOptions(result.users);
        } catch {
            if (seq === searchSeq.current) setOptions([]);
        } finally {
            if (seq === searchSeq.current) setSearching(false);
        }
    };

    useEffect(() => {
        if (!current) void search("");
    }, []);

    const userOptions = useMemo(() => options.map((user) => ({ value: user.id, label: `${user.displayName || user.username}（${user.username}）` })), [options]);

    const save = async () => {
        const values = await form.validateFields();
        setSaving(true);
        try {
            await setAdminUserStorageQuota(values.userId, Math.round(values.storageGB * GB), values.note?.trim());
            message.success("已保存用户容量");
            onSaved();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存用户容量失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal open title={current ? `修改 ${current.displayName || current.username} 的容量` : "为用户设置容量"} okText="保存" confirmLoading={saving} onOk={() => void save()} onCancel={onClose} destroyOnHidden>
            <Form form={form} layout="vertical">
                {current ? (
                    <Form.Item name="userId" hidden>
                        <Input />
                    </Form.Item>
                ) : (
                    <Form.Item name="userId" label="用户" rules={[{ required: true, message: "请选择用户" }]}>
                        <Select showSearch placeholder="输入用户名、昵称或邮箱搜索" filterOption={false} onSearch={(value) => void search(value)} options={userOptions} notFoundContent={searching ? <Spin size="small" /> : "没有找到用户"} />
                    </Form.Item>
                )}
                <Form.Item name="storageGB" label="基础容量（GB）" extra="可填小数，例如 0.5 表示 512 MB；范围 0.1–100000 GB。赠送和购买的扩容会在这个基础上累加。" rules={[{ required: true, message: "请填写容量" }, { type: "number", min: 0.1, max: 100_000, message: "0.1–100000 GB" }]}>
                    <InputNumber min={0.1} max={100_000} step={1} precision={2} addonAfter="GB" style={{ width: "100%" }} />
                </Form.Item>
                <Form.Item name="note" label="备注" rules={[{ max: 200 }]}>
                    <Input placeholder="可选，例如：合作客户" />
                </Form.Item>
            </Form>
        </Modal>
    );
}
