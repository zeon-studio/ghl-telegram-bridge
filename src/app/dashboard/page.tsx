"use client";

/**
 * app/dashboard/page.tsx
 * -----------------------
 * GHL Custom Page — embedded as an iframe inside GoHighLevel.
 */

import { useEffect, useState } from "react";
import { AddBotDialog } from "./components/AddBotDialog";
import { AddPhoneAccountDialog } from "./components/AddPhoneAccountDialog";
import { AgencyDashboard } from "./components/AgencyDashboard";
import { BotList } from "./components/BotList";
import { PhoneAccountList } from "./components/PhoneAccountList";
import { DashboardHeader } from "./components/DashboardHeader";
import { MessageActivity } from "./components/MessageActivity";
import { Onboarding } from "./components/Onboarding";
import { GHLSession, TelegramBot, TelegramPhoneAccount } from "./types";

export default function DashboardPage() {
  const [session, setSession] = useState<GHLSession | null>(null);
  const [isAgency, setIsAgency] = useState(false);
  const [bots, setBots] = useState<TelegramBot[]>([]);
  const [phoneAccounts, setPhoneAccounts] = useState<TelegramPhoneAccount[]>([]);
  const [phoneAccountsEnabled, setPhoneAccountsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  // ── Mount: attempt GHL SSO ─────────────────────────────────────────────────

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let locationId = params.get("locationId");
    let companyId = params.get("companyId");

    if (!locationId) {
      try {
        locationId = localStorage.getItem("ghl_location_id");
      } catch {
        // ignore — fall through
      }
    }

    if (!companyId) {
      try {
        companyId = localStorage.getItem("ghl_company_id");
      } catch {
        // ignore
      }
    }

    // ── Agency Mode ────────────────────────────────────────────────────────
    if (!locationId && companyId) {
      try {
        localStorage.setItem("ghl_company_id", companyId);
      } catch {
        // non-fatal
      }

      setIsAgency(true);
      fetch(`/api/session?companyId=${encodeURIComponent(companyId)}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.session) {
            setSession({
              locationId: "",
              userId: data.session.userId ?? "agency_user",
              companyId: data.session.companyId ?? companyId as string,
            });
          } else {
            setSession({
              locationId: "",
              userId: "agency_user",
              companyId: companyId as string,
            });
          }
        })
        .catch(() => {
          setSession({
            locationId: "",
            userId: "agency_user",
            companyId: companyId as string,
          });
        })
        .finally(() => setLoading(false));
      return;
    }

    // ── Sub-Account Mode ───────────────────────────────────────────────────
    if (!locationId) {
      // Check if there is an active agency session before showing error
      fetch("/api/session")
        .then((res) => res.json())
        .then(() => {
          setErrorMsg("Could not obtain location context. Ensure the page is opened from within the CRM.");
        })
        .catch(() => {
          setErrorMsg("Could not obtain location context. Ensure the page is opened from within the CRM.");
        })
        .finally(() => setLoading(false));
      return;
    }

    try {
      localStorage.setItem("ghl_location_id", locationId);
    } catch {
      // non-fatal
    }

    fetch(`/api/session?locationId=${encodeURIComponent(locationId)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.session) {
          setSession(data.session);
        } else {
          setSession({ locationId: locationId as string, userId: "user" });
        }
      })
      .catch(() => {
        setSession({ locationId: locationId as string, userId: "user" });
      })
      .finally(() => setLoading(false));
  }, []);

  // ── Load bots + phone accounts once we have a location ──────────────────────

  useEffect(() => {
    if (!session?.locationId) return;
    fetch(`/api/telegram/bots?locationId=${encodeURIComponent(session.locationId)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setBots(data.bots);
      });
    fetch(`/api/telegram/phone-accounts?locationId=${encodeURIComponent(session.locationId)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setPhoneAccounts(data.accounts);
      });
  }, [session?.locationId]);

  // ── Check whether Phone Account is configured at all ─────────────────────────

  useEffect(() => {
    fetch("/api/telegram/phone-accounts/config")
      .then((res) => res.json())
      .then((data) => setPhoneAccountsEnabled(Boolean(data.enabled)))
      .catch(() => setPhoneAccountsEnabled(false));
  }, []);

  const handleToggleActive = async (botId: string, isActive: boolean) => {
    setBots((prev) => prev.map((b) => (b.id === botId ? { ...b, isActive } : b)));
    await fetch(`/api/telegram/bots/${botId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive }),
    });
  };

  const handleDelete = async (botId: string) => {
    setBots((prev) => prev.filter((b) => b.id !== botId));
    await fetch(`/api/telegram/bots/${botId}`, { method: "DELETE" });
  };

  const handleTogglePhoneActive = async (accountId: string, isActive: boolean) => {
    setPhoneAccounts((prev) => prev.map((a) => (a.id === accountId ? { ...a, isActive } : a)));
    await fetch(`/api/telegram/phone-accounts/${accountId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive }),
    });
  };

  const handleDeletePhoneAccount = async (accountId: string) => {
    setPhoneAccounts((prev) => prev.filter((a) => a.id !== accountId));
    await fetch(`/api/telegram/phone-accounts/${accountId}`, { method: "DELETE" });
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-background flex flex-col">
      <DashboardHeader session={session} />

      <div className="flex-1 w-full p-4 md:p-8 flex flex-col gap-6 mx-auto max-w-4xl">
        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-10">Loading…</p>
        ) : errorMsg ? (
          <p className="text-sm text-destructive text-center py-10">{errorMsg}</p>
        ) : isAgency ? (
          <AgencyDashboard companyId={session?.companyId} userId={session?.userId} />
        ) : session ? (
          <div className="flex flex-col gap-6 w-full">
            <Onboarding />

            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Your Bots</h2>
              <AddBotDialog
                locationId={session.locationId}
                onAdded={(bot) => setBots((prev) => [...prev, bot])}
              />
            </div>
            <BotList bots={bots} onToggleActive={handleToggleActive} onDelete={handleDelete} />

            {/* Phone Accounts are a self-hosted-only feature — the hosted
                marketplace build runs without TELEGRAM_API_ID/API_HASH, so
                the section is hidden rather than shown permanently greyed
                out. It reappears for anyone self-hosting with their own
                Telegram API credentials, and stays visible if accounts
                already exist so they never become unmanageable. */}
            {(phoneAccountsEnabled || phoneAccounts.length > 0) && (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Your Phone Accounts</h2>
                  <AddPhoneAccountDialog
                    locationId={session.locationId}
                    disabled={!phoneAccountsEnabled}
                    onAdded={(account) => setPhoneAccounts((prev) => [...prev, account])}
                  />
                </div>
                <PhoneAccountList
                  accounts={phoneAccounts}
                  onToggleActive={handleTogglePhoneActive}
                  onDelete={handleDeletePhoneAccount}
                />
              </>
            )}

            <MessageActivity locationId={session.locationId} />
          </div>
        ) : null}
      </div>
    </main>
  );
}
