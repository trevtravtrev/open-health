import {signOut} from "next-auth/react";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

export default function LogoutButton() {
    return (
        <Button
            onClick={() => signOut()}
            variant="ghost"
            className="text-muted-foreground hover:text-foreground"
        >
            <LogOut className="w-4 h-4" />
        </Button>
    );
}
