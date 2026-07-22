"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { TelegramBot } from "../types";

interface AddBotDialogProps {
  locationId: string;
  onAdded: (bot: TelegramBot) => void;
}

export function AddBotDialog({ locationId, onAdded }: AddBotDialogProps) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!token.trim()) return;
    setSubmitting(true);
    setError(null);

    try {
      const resp = await fetch("/api/telegram/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId,
          botToken: token.trim(),
          displayName: displayName.trim() || undefined,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) {
        setError(data.error ?? "Failed to add bot");
        return;
      }
      onAdded(data.bot);
      setToken("");
      setDisplayName("");
      setOpen(false);
    } catch {
      setError("Network error while adding bot");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <Plus className="w-4 h-4" />
            Add Telegram Bot
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect a Telegram Bot</DialogTitle>
          <DialogDescription>
            Paste the token you got from{" "}
            <code className="bg-muted px-1 py-0.5 rounded text-xs">@BotFather</code>. We&apos;ll
            validate it and set up the webhook automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="botToken">Bot Token *</Label>
            <Input
              id="botToken"
              type="password"
              placeholder="123456789:AAExampleTokenValueHere"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="displayName">Label (optional)</Label>
            <Input
              id="displayName"
              type="text"
              placeholder="Support Bot"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={submitting}
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={submitting || !token.trim()}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Connecting…
              </>
            ) : (
              "Connect Bot"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
