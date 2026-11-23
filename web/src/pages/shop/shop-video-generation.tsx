import { SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";

import { WorkbenchPage, type WorkbenchComposerParts } from "@/pages/workbench/image-workbench-page";
import { ShopCreationPortal } from "./shop-creation-dock";
import { ShopDropdown } from "./shop-dropdown";
import "./shop-video-generation.css";

/** 普通生视频复用工作台的上传、模型能力、报价、提交和任务恢复。 */
export function ShopVideoGeneration({ active, kindPicker }: { active: boolean; kindPicker: ReactNode }) {
    const composer = ({ inputs, settings, footer, modelLabel, specLabel, onPaste }: WorkbenchComposerParts) =>
        active ? (
            <ShopCreationPortal>
                <div className="svg-composer wb-shell" onPasteCapture={onPaste}>
                    <div className="svg-inputs">{inputs}</div>
                    <div className="svg-toolbar">
                        <div className="svg-controls">
                            {kindPicker}
                            <ShopDropdown
                                placement="top"
                                width={400}
                                ariaLabel="视频模型与参数"
                                icon={<SlidersHorizontal className="size-3.5" />}
                                label={
                                    <>
                                        <span className="svg-model-label">{modelLabel}</span>
                                        <span className="svg-spec-label">{specLabel}</span>
                                    </>
                                }
                            >
                                {() => <div className="svg-settings wb-shell">{settings}</div>}
                            </ShopDropdown>
                        </div>
                        {footer}
                    </div>
                </div>
            </ShopCreationPortal>
        ) : null;
    return (
        <div className="svg-workspace" hidden={!active}>
            <WorkbenchPage kind="video" renderComposer={composer} galleryPresentation="timeline" modelPickerPresentation="inline" />
        </div>
    );
}
