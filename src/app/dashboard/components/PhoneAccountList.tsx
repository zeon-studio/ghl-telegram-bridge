"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Phone, Trash2 } from "lucide-react";
import { TelegramPhoneAccount } from "../types";

interface PhoneAccountListProps {
  accounts: TelegramPhoneAccount[];
  onToggleActive: (accountId: string, isActive: boolean) => void;
  onDelete: (accountId: string) => void;
}

export function PhoneAccountList({ accounts, onToggleActive, onDelete }: PhoneAccountListProps) {
  if (accounts.length === 0) {
    return (
      <Card className="w-full">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No Telegram phone accounts connected yet. Add one below to sync a real Telegram account
          into your Inbox.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {accounts.map((account) => (
        <Card key={account.id} className="w-full">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Phone className="w-4 h-4 text-primary" />
              {account.displayName || account.phoneNumber}
            </CardTitle>
            <Badge
              variant={account.needsAttention || !account.isActive ? "secondary" : "outline"}
              className="text-[10px] uppercase"
            >
              {account.needsAttention ? "Attention" : account.isActive ? "Active" : "Paused"}
            </Badge>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {account.phoneNumber}
              {account.telegramUsername ? ` · @${account.telegramUsername}` : ""}
            </p>
            <div className="flex items-center gap-2">
              <Switch
                checked={account.isActive}
                onCheckedChange={(checked: boolean) => onToggleActive(account.id, checked)}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-destructive hover:text-destructive"
                onClick={() => onDelete(account.id)}
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
