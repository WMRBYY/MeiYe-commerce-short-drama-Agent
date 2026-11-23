import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

import { FullScreenLoader } from "@/components/ui/aceternity/full-screen-loader";
import { useUserStore } from "@/stores/use-user-store";

export function RequireAuth({ children }: { children: ReactNode }) {
    const location = useLocation();
    const hydrated = useUserStore((state) => state.hydrated);
    const user = useUserStore((state) => state.user);

    if (!hydrated) return <FullScreenLoader />;
    if (!user) {
        const admin = location.pathname === "/admin" || location.pathname.startsWith("/admin/");
        return <Navigate to={`/login?${admin ? "mode=admin&" : ""}next=${encodeURIComponent(location.pathname + location.search + location.hash)}`} replace />;
    }
    return children;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
    const hydrated = useUserStore((state) => state.hydrated);
    const user = useUserStore((state) => state.user);
    if (!hydrated) return <FullScreenLoader />;
    if (!user) return <Navigate to="/login" replace />;
    if (user.role !== "admin") return <Navigate to="/" replace />;
    return children;
}
