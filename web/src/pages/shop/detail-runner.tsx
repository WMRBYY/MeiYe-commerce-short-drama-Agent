import { useEffect } from "react";
import { resumeDetailRequests } from "./detail-outbox";
import { useDetailRuns } from "./detail-runs";

// This component reconciles unacknowledged requests only. Analysis and image
// generation continue in the server worker even when no browser is connected.
export function DetailRunners({ scope }: { scope: string }) {
    useEffect(() => {
        let active = true;
        let running = false;
        useDetailRuns.getState().reset(scope);
        const restore = async () => {
            if (running || !active) return;
            running = true;
            try {
                await resumeDetailRequests(scope, (project) => {
                    if (active) useDetailRuns.getState().save("", project);
                });
            } finally {
                running = false;
            }
        };
        const reconnect = () => void restore().catch(() => undefined);
        reconnect();
        const timer = window.setInterval(reconnect, 15000);
        window.addEventListener("online", reconnect);
        return () => {
            active = false;
            window.clearInterval(timer);
            window.removeEventListener("online", reconnect);
        };
    }, [scope]);
    return null;
}
