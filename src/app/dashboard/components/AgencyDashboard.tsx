"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Bot, Building2, Layers, ArrowRight, ShieldCheck } from "lucide-react";

interface AgencyDashboardProps {
  companyId?: string;
  userId?: string;
}

export function AgencyDashboard({ companyId, userId }: AgencyDashboardProps) {
  const steps = [
    {
      icon: Layers,
      title: "1. Distribute to Sub-Accounts",
      desc: "In your Agency Settings → Marketplace, ensure Telegram Bridge is enabled for the sub-accounts you want to use it in.",
    },
    {
      icon: Building2,
      title: "2. Switch to a Sub-Account",
      desc: "Open any authorized sub-account from your HighLevel dashboard dropdown switcher.",
    },
    {
      icon: Bot,
      title: "3. Connect Telegram Bots",
      desc: "Inside that sub-account, open Telegram Bridge to add bots and sync conversations directly to that location's Inbox.",
    },
  ];

  return (
    <div className="flex flex-col gap-6 w-full max-w-4xl mx-auto py-4">
      {/* Hero / Status Banner */}
      <Card className="w-full relative overflow-hidden border-primary/20 bg-linear-to-b from-primary/10 via-background to-background shadow-md">
        <div className="absolute top-0 left-0 w-full h-1 bg-linear-to-r from-primary/40 via-primary to-primary/40" />

        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/15 text-primary">
                <Building2 className="w-5 h-5" />
              </div>
              <div>
                <CardTitle className="text-xl font-bold">Agency Management</CardTitle>
                <CardDescription className="text-sm">
                  Telegram Bridge is active and authorized for your Agency
                </CardDescription>
              </div>
            </div>
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 px-3 py-1 text-xs font-semibold gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Authorized & Ready
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 text-xs">
            {companyId && (
              <div className="p-3 rounded-lg bg-background/80 border border-border/60">
                <span className="text-muted-foreground block mb-0.5">Company ID</span>
                <span className="font-mono font-medium text-foreground">{companyId}</span>
              </div>
            )}
            {userId && (
              <div className="p-3 rounded-lg bg-background/80 border border-border/60">
                <span className="text-muted-foreground block mb-0.5">Authorized By User</span>
                <span className="font-mono font-medium text-foreground">{userId}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* How It Works for Sub-Accounts */}
      <Card className="w-full shadow-sm">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" />
            How Sub-Account Integration Works
          </CardTitle>
          <CardDescription className="text-xs">
            Telegram Bridge operates on a per-subaccount basis so each client gets dedicated bots, conversation routing, and contact syncing.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            {steps.map((step) => {
              const Icon = step.icon;
              return (
                <div
                  key={step.title}
                  className="flex flex-col gap-2.5 p-4 rounded-xl bg-muted/40 border border-border/60 transition-colors hover:bg-muted/70"
                >
                  <div className="flex items-center gap-2">
                    <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary/10 text-primary">
                      <Icon className="w-4 h-4" />
                    </div>
                    <h3 className="font-semibold text-sm leading-tight">{step.title}</h3>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {step.desc}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="mt-6 p-4 rounded-lg bg-primary/5 border border-primary/10 flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-foreground">Ready to configure your first bot?</p>
              <p className="text-xs text-muted-foreground">Switch to any sub-account in HighLevel to access the bot management dashboard.</p>
            </div>
            <div className="flex items-center text-xs font-semibold text-primary gap-1 shrink-0">
              Sub-Account Context <ArrowRight className="w-3.5 h-3.5" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
