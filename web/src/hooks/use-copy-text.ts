import copy from "copy-to-clipboard";
import { App } from "antd";
import { useTranslation } from "react-i18next";

export function useCopyText() {
    const { t } = useTranslation();
    const feedback = App.useApp().message;
    return (value: string, successText = t("workspace.copy.copied")) => {
        copy(String(value));
        feedback.success(successText);
    };
}
