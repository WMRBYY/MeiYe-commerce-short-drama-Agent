import { ScrollText } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useTranslation } from "react-i18next";

import { AppDrawer } from "@/components/ui/product/app-drawer";
import { BrandLogoFrame } from "@/components/brand/brand-logo";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { updateAnnouncementVersion } from "@/lib/update-announcement";
import { UpdateAnnouncementContent } from "./update-announcement-content";
import "./app-changelog-drawer.css";

export function AppChangelogDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { t } = useTranslation();
    const updates = useAppearanceStore((state) => state.appearance.updates);
    const custom = Boolean(updates?.enabled);
    const version = updateAnnouncementVersion(updates, __APP_VERSION__);

    return (
        <AppDrawer
            rootClassName="app-changelog-drawer"
            title={
                <div className="app-changelog-heading">
                    <span className="app-changelog-heading-icon">
                        <BrandLogoFrame className="app-changelog-brand-logo" logoClassName="size-5 object-contain" alt="" fallback={<ScrollText className="size-4" />} />
                    </span>
                    <div className="app-changelog-heading-copy">
                        <div className="app-changelog-heading-title">{t("workspace.changelog.title")}</div>
                        <div className="app-changelog-heading-description">{custom ? t("workspace.changelog.customDescription") : t("workspace.changelog.defaultDescription")}</div>
                    </div>
                </div>
            }
            open={open}
            placement="right"
            width="min(760px, 100vw)"
            onClose={onClose}
        >
            <div className="app-changelog-scroll thin-scrollbar">
                <span className="app-changelog-current-version">{t("account.layout.changelog.currentVersion", { version })}</span>
                {custom && updates ? (
                    <UpdateAnnouncementContent value={updates} />
                ) : (
                    <ReactMarkdown
                        components={{
                            h1: () => null,
                            h2: ({ children }) => {
                                const label = String(children);
                                const latest = label === "Unreleased";

                                return (
                                    <h3 className={`app-changelog-section-heading${latest ? " is-latest" : ""}`}>
                                        <span className="app-changelog-section-marker" aria-hidden="true" />
                                        <span>{latest ? t("account.layout.changelog.unreleased") : label}</span>
                                        {latest ? <span className="app-changelog-latest-badge">{t("account.layout.changelog.latest")}</span> : null}
                                    </h3>
                                );
                            },
                            ul: ({ children }) => <ul className="app-changelog-list">{children}</ul>,
                            li: ({ children }) => <li>{children}</li>,
                            p: ({ children }) => <p className="app-changelog-paragraph">{children}</p>,
                            code: ({ children }) => <code className="app-changelog-code">{children}</code>,
                        }}
                    >
                        {__APP_CHANGELOG__}
                    </ReactMarkdown>
                )}
            </div>
        </AppDrawer>
    );
}
