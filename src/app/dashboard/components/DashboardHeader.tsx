import { ModeToggle } from "@/components/mode-toggle";
import { GHLSession } from "../types";

export function DashboardHeader(_session: { session?: GHLSession | null }) {
  return (
    <div className="fixed bottom-4 right-4 z-50">
      <ModeToggle />
    </div>
  );
}
