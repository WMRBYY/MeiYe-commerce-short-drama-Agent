import { LoginDialog } from "@/pages/auth/login-dialog";

export function CreationLoginDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    return <LoginDialog open={open} onClose={onClose} next={window.location.pathname + window.location.search} />;
}
