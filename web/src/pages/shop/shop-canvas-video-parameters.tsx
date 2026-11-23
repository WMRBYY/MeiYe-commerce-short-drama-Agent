import { Button } from "antd";
import { AudioLines, Image as ImageIcon, Video } from "lucide-react";

import { resourceVariantUrl } from "@/services/api/resources";
import "./shop-canvas-normal-video.css";

type VideoParameterAsset = { resourceId: string; name: string; kind: "image" | "video" | "audio" };

export function ShopCanvasVideoParameters({
    status,
    prompt,
    items,
    references = [],
    onReuse,
}: {
    status: string;
    prompt?: string;
    items: Array<[label: string, value: string | undefined]>;
    references?: VideoParameterAsset[];
    onReuse?: () => void;
}) {
    const parameters = items.filter(([, value]) => value);
    return (
        <div className="sp-canvas-video-parameters" data-canvas-wheel-scroll>
            <p className="sp-canvas-video-run-status" role="status">{status}</p>
            {references.length > 0 && (
                <ul aria-label="参考素材">
                    {references.map(({ resourceId, kind, name }, index) => {
                        const Icon = kind === "audio" ? AudioLines : kind === "video" ? Video : ImageIcon;
                        return (
                            <li key={`${resourceId}:${index}`} title={name}>
                                {kind === "image" ? <img src={resourceVariantUrl(resourceId, "thumbnail")} alt="" loading="lazy" /> : <Icon size={15} aria-hidden />}
                                <span>{name}</span>
                            </li>
                        );
                    })}
                </ul>
            )}
            {prompt && <p className="sp-canvas-video-run-prompt" aria-label="提交时的描述">{prompt}</p>}
            {parameters.length > 0 && (
                <dl>
                    {parameters.map(([label, value]) => (
                        <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                    ))}
                </dl>
            )}
            {onReuse && <Button className="sp-canvas-video-run-reuse" onClick={onReuse}>使用参数新建</Button>}
        </div>
    );
}
