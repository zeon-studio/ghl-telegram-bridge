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
import { TelegramPhoneAccount } from "../types";

interface AddPhoneAccountDialogProps {
  locationId: string;
  disabled?: boolean;
  onAdded: (account: TelegramPhoneAccount) => void;
}

type Step = "phone" | "code" | "password" | "success";

export function AddPhoneAccountDialog({ locationId, disabled, onAdded }: AddPhoneAccountDialogProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("phone");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loginToken, setLoginToken] = useState<string | null>(null);
  const [account, setAccount] = useState<TelegramPhoneAccount | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setStep("phone");
    setPhoneNumber("");
    setCode("");
    setPassword("");
    setDisplayName("");
    setLoginToken(null);
    setAccount(null);
    setError(null);
  };

  const handleSendCode = async () => {
    if (!phoneNumber.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const resp = await fetch("/api/telegram/phone-accounts/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId, phoneNumber: phoneNumber.trim() }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) {
        setError(data.error ?? "Failed to send code");
        return;
      }
      setLoginToken(data.loginToken);
      setStep("code");
    } catch {
      setError("Network error while sending code");
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!code.trim() || !loginToken) return;
    setSubmitting(true);
    setError(null);
    try {
      const resp = await fetch("/api/telegram/phone-accounts/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginToken, code: code.trim() }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) {
        setError(data.error ?? "Invalid code");
        return;
      }
      if (data.needs2FA) {
        setStep("password");
      } else {
        setAccount(data.account);
        setStep("success");
      }
    } catch {
      setError("Network error while verifying code");
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyPassword = async () => {
    if (!password.trim() || !loginToken) return;
    setSubmitting(true);
    setError(null);
    try {
      const resp = await fetch("/api/telegram/phone-accounts/verify-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginToken, password: password.trim() }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) {
        setError(data.error ?? "Incorrect password");
        return;
      }
      setAccount(data.account);
      setStep("success");
    } catch {
      setError("Network error while verifying password");
    } finally {
      setSubmitting(false);
    }
  };

  const handleFinish = async () => {
    if (!account) return;
    setSubmitting(true);
    try {
      if (displayName.trim()) {
        await fetch(`/api/telegram/phone-accounts/${account.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName: displayName.trim() }),
        });
      }
      onAdded({ ...account, displayName: displayName.trim() || account.displayName });
      setOpen(false);
      reset();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger
        render={
          <Button
            disabled={disabled}
            title={
              disabled
                ? "Telegram API credentials not configured — set TELEGRAM_API_ID/TELEGRAM_API_HASH"
                : undefined
            }
          >
            <Plus className="w-4 h-4" />
            Add Phone Account
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect a Phone Account</DialogTitle>
          <DialogDescription>
            Link your personal or business Telegram phone number. Your actual account syncs in —
            no bot required. Supports groups, channels, and direct messages.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {step === "phone" && (
            <div className="space-y-2">
              <Label htmlFor="phoneNumber">Phone Number *</Label>
              <Input
                id="phoneNumber"
                type="tel"
                placeholder="+15551234567"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                disabled={submitting}
              />
            </div>
          )}

          {step === "code" && (
            <div className="space-y-2">
              <Label htmlFor="code">Code sent to {phoneNumber} *</Label>
              <Input
                id="code"
                type="text"
                placeholder="12345"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={submitting}
              />
            </div>
          )}

          {step === "password" && (
            <div className="space-y-2">
              <Label htmlFor="password">2FA Password *</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
              />
            </div>
          )}

          {step === "success" && account && (
            <div className="space-y-4">
              <p className="text-sm">
                Connected {account.telegramUsername ? `@${account.telegramUsername}` : account.phoneNumber}.
              </p>
              <div className="space-y-2">
                <Label htmlFor="displayName">Label (optional)</Label>
                <Input
                  id="displayName"
                  type="text"
                  placeholder="Support Line"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  disabled={submitting}
                />
              </div>
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          {step === "phone" && (
            <Button onClick={handleSendCode} disabled={submitting || !phoneNumber.trim()}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send Code
            </Button>
          )}
          {step === "code" && (
            <Button onClick={handleVerifyCode} disabled={submitting || !code.trim()}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Verify
            </Button>
          )}
          {step === "password" && (
            <Button onClick={handleVerifyPassword} disabled={submitting || !password.trim()}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Verify
            </Button>
          )}
          {step === "success" && (
            <Button onClick={handleFinish} disabled={submitting}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
