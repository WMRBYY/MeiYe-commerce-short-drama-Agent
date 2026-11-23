import { useEffect, useState } from "react";
import type { Skill } from "@/services/api/skills";
import { resolveResourceAccessURL } from "@/services/api/resources";
import generatedCoverIds from "./generated-cover-ids.json";
import "./skill-visual-cover.css";

const categories = new Set(["drama", "ecommerce", "creative", "social", "others"]);
const generatedCovers = new Set(generatedCoverIds);

export function skillCoverFallback(skill: Pick<Skill, "skillId" | "tag">) {
    const id = /^[a-zA-Z0-9_-]+$/.test(skill.skillId) ? skill.skillId : "";
    const tag = categories.has(skill.tag) ? skill.tag : "others";
    return id ? `/skill-covers/${id}.svg` : `/skill-covers/fallback-${tag}.svg`;
}

export function skillVisualTagline(skill: Pick<Skill, "description"> & { displayTagline?: string }) {
    const source = (skill.displayTagline || skill.description || "").trim().replace(/^本技能(?:用于|可以|通过|基于|输出|生成)?/, "").trim();
    const first = source.split(/[。；;\n]/)[0]?.trim() || "了解技能的创作方式";
    return first.length > 32 ? `${first.slice(0, 31)}…` : first;
}

export function SkillVisualCover({ skill, className = "", priority = false }: { skill: Skill; className?: string; priority?: boolean }) {
    const image = skill.showcaseMedia?.find((item) => item.type === "image" && item.showcaseUrl)?.showcaseUrl || "";
    // A former imported repository moved its showcase directory; all known URLs now return 404.
    const preferred = resolveResourceAccessURL(skill.displayCoverUrl || "");
    // Admin-managed covers take precedence; the original case remains available if a generated cover fails.
    const showcase = image.includes("raw.githubusercontent.com/itsWyatt-K/judian-skills/main/showcase/") ? "" : image;
    const generated = generatedCovers.has(skill.skillId) ? `/skill-covers/${skill.skillId}.webp` : "";
    const fallback = skillCoverFallback(skill);
    const categoryFallback = `/skill-covers/fallback-${categories.has(skill.tag) ? skill.tag : "others"}.svg`;
    const [source, setSource] = useState(preferred || generated || showcase || fallback);
    useEffect(() => setSource(preferred || generated || showcase || fallback), [preferred, generated, showcase, fallback]);
    const sources = [preferred, generated, showcase, fallback, categoryFallback].filter(Boolean);

    return (
        <span className={`skill-visual-cover ${className}`}>
            <img
                src={source}
                srcSet={generated && source === generated ? `/skill-covers/${skill.skillId}-sm.webp 480w, ${generated} 960w` : undefined}
                sizes={generated && source === generated ? "(max-width: 600px) 50vw, (max-width: 1100px) 33vw, 25vw" : undefined}
                alt={`${skill.skillName}${source === generated ? "原创视觉示意" : "技能封面"}`}
                loading={priority ? "eager" : "lazy"}
                decoding="async"
                onError={() => setSource((current) => sources[sources.indexOf(current) + 1] || current)}
            />
            {generated && source === generated ? <span className="skill-visual-cover-label">原创示意</span> : null}
        </span>
    );
}
