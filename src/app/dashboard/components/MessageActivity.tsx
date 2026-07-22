"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowDownLeft, ArrowUpRight, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { MessageLogEntry } from "../types";

export function MessageActivity({ locationId }: { locationId: string }) {
  const [messages, setMessages] = useState<MessageLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const loadMessages = async () => {
    setLoading(true);
    try {
      const resp = await fetch(`/api/telegram/messages?locationId=${encodeURIComponent(locationId)}`);
      const data = await resp.json();
      if (data.success) setMessages(data.messages);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

  const handleRetry = async (id: string) => {
    setRetryingId(id);
    try {
      await fetch(`/api/telegram/messages/${id}/retry`, { method: "POST" });
      await loadMessages();
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-base">Recent Activity</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading messages…
          </div>
        ) : messages.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No messages yet.</p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className="flex items-start justify-between gap-3 py-2 border-b last:border-b-0 text-sm"
            >
              <div className="flex items-start gap-2 min-w-0">
                {m.direction === "INBOUND" ? (
                  <ArrowDownLeft className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                ) : (
                  <ArrowUpRight className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                )}
                <div className="min-w-0">
                  <p className="truncate">{m.textContent || `[${m.contentType}]`}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {m.contactName ?? "Unknown contact"} · {new Date(m.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
              <div className="shrink-0 flex items-center gap-2">
                <Badge variant={m.status === "FAILED" ? "outline" : "secondary"} className="text-[10px]">
                  {m.status}
                </Badge>
                {m.status === "FAILED" && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleRetry(m.id)}
                    disabled={retryingId === m.id}
                  >
                    {retryingId === m.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="w-3.5 h-3.5" />
                    )}
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
