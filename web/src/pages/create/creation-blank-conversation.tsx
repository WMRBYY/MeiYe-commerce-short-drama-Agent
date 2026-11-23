// 新建对话的空状态：问候 + 三张可直接试用的创意卡，输入框留在页面底部。

import { motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { curatedInspirations } from "@/lib/inspirations/catalog";
import type { CreationMode } from "./creation-assets";
import { modeLabels } from "./creation-types";
import "./creation-blank-conversation.css";

const BLANK_CARD_COUNT = 3;

export function CreationBlankConversation({ greetingName, onTry }: { greetingName: string; onTry: (mode: CreationMode, prompt: string) => void }) {
    const { t } = useTranslation();
    const reducedMotion = useReducedMotion();
    const usable = curatedInspirations.filter((item) => item.image && item.prompt);
    const cards = [...usable.filter((item) => item.mode === "image"), ...usable.filter((item) => item.mode !== "image")].slice(0, BLANK_CARD_COUNT);
    return (
        <section className="creation-blank-conversation" aria-label={t("create.blankConversation.label")}>
            <motion.h1
                initial={reducedMotion ? false : { opacity: 0, y: 12, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            >
                {greetingName ? t("create.blankConversation.greetingNamed", { name: greetingName }) : t("create.blankConversation.greetingGuest")}
            </motion.h1>
            {cards.length ? (
                <div className="creation-blank-cards">
                    {cards.map((item, index) => (
                        <motion.article
                            key={item.title}
                            className="creation-blank-card"
                            initial={reducedMotion ? false : { opacity: 0, y: 16 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.45, delay: reducedMotion ? 0 : 0.08 + index * 0.06, ease: [0.22, 1, 0.36, 1] }}
                        >
                            <div className="creation-blank-card-media">
                                <img src={item.image} alt="" loading="lazy" decoding="async" />
                                <span className="creation-blank-card-tag">{modeLabels[item.mode]}</span>
                                <div className="creation-blank-card-title">
                                    <strong>{item.title}</strong>
                                    <button type="button" onClick={() => onTry(item.mode, item.prompt)}>{t("create.blankConversation.tryIt")}</button>
                                </div>
                            </div>
                            <p>{item.description}</p>
                        </motion.article>
                    ))}
                </div>
            ) : null}
        </section>
    );
}
