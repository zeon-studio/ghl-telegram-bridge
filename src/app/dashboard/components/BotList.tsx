"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Bot, Trash2 } from "lucide-react";
import { TelegramBot } from "../types";

interface BotListProps {
  bots: TelegramBot[];
  onToggleActive: (botId: string, isActive: boolean) => void;
  onDelete: (botId: string) => void;
}

export function BotList({ bots, onToggleActive, onDelete }: BotListProps) {
  if (bots.length === 0) {
    return (
      <Card className="w-full">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No Telegram bots connected yet. Add one below to start receiving messages in your Inbox.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {bots.map((bot) => (
        <Card key={bot.id} className="w-full">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Bot className="w-4 h-4 text-primary" />
              {bot.displayName || `@${bot.botUsername}`}
            </CardTitle>
            <Badge variant={bot.isActive ? "outline" : "secondary"} className="text-[10px] uppercase">
              {bot.isActive ? "Active" : "Paused"}
            </Badge>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">@{bot.botUsername}</p>
            <div className="flex items-center gap-2">
              <Switch
                checked={bot.isActive}
                onCheckedChange={(checked: boolean) => onToggleActive(bot.id, checked)}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-destructive hover:text-destructive"
                onClick={() => onDelete(bot.id)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
