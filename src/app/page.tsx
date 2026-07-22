import { ModeToggle } from "@/components/mode-toggle";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Telegram for GHL – Two-Way Telegram Messaging in Your Inbox",
  description:
    "Connect Telegram bots or a phone-number account to your GoHighLevel sub-account and get two-way messaging right inside your native GHL Inbox.",
};

const STEPS = [
  {
    n: 1,
    title: "Connect your sub-account",
    desc: "OAuth 2.0 authorization — no passwords stored.",
  },
  {
    n: 2,
    title: "Connect Telegram",
    desc: "Paste a bot token from @BotFather, or log in with a phone number to sync a whole account.",
  },
  {
    n: 3,
    title: "Contacts sync automatically",
    desc: "New GHL contacts are created the moment someone messages your bot.",
  },
  {
    n: 4,
    title: "Reply from your Inbox",
    desc: "Two-way sync — replies from your GHL Inbox go straight back to Telegram.",
  },
];

export default function LandingPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 relative overflow-hidden bg-background">
      {/* Decorative background elements */}
      <div className="absolute top-0 inset-x-0 h-64 bg-linear-to-b from-primary/5 to-transparent pointer-events-none" />

      {/* Theme toggle */}
      <div className="absolute top-4 right-4 z-50">
        <ModeToggle />
      </div>

      <div className="max-w-2xl w-full flex flex-col items-center text-center gap-8 z-10">
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">
          Bring Telegram into <br className="hidden sm:inline" />
          <span className="text-primary">your GHL Inbox</span>
        </h1>

        <p className="text-muted-foreground text-lg max-w-lg">
          Connect Telegram to your GoHighLevel sub-account — one or more bots,
          or a full account via phone number login. Messages from Telegram
          show up as a native conversation in your Inbox, and replies you send
          go straight back to Telegram — no separate app to check.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-4">
          <a
            href="/api/auth/ghl"
            className={buttonVariants({
              size: "lg",
              className: "px-8 font-semibold",
            })}
          >
            Connect Platform
          </a>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full mt-8">
          {STEPS.map(({ n, title, desc }) => (
            <Card
              key={n}
              className="text-left border-muted bg-card hover:border-primary/50 transition-colors"
            >
              <CardHeader className="p-5">
                <div className="flex items-center gap-4 mb-2">
                  <div className="flex items-center justify-center size-8 rounded-full bg-primary/10 text-primary font-bold text-sm shrink-0">
                    {n}
                  </div>
                  <CardTitle className="text-base font-semibold">
                    {title}
                  </CardTitle>
                </div>
                <CardDescription className="text-sm">{desc}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
          <Card className="text-left border-muted bg-card">
            <CardHeader className="p-5">
              <CardTitle className="text-base font-semibold">
                Telegram Bot
              </CardTitle>
              <CardDescription className="text-sm">
                Connect one or more bots via @BotFather — a focused line for
                support or sales, managed independently per sub-account.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card className="text-left border-muted bg-card">
            <CardHeader className="p-5">
              <CardTitle className="text-base font-semibold">
                Phone Account
              </CardTitle>
              <CardDescription className="text-sm">
                Log in with a real phone number to sync an entire personal or
                business account — DMs, groups, and channels — into the
                Inbox.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>

        <p className="text-sm text-muted-foreground mt-4">
          Requires GoHighLevel sub-account access to connect
        </p>

        <footer className="mt-16 w-full flex items-center justify-center gap-6 pt-8 border-t text-sm text-muted-foreground">
          <Link
            href="/privacy"
            className="hover:text-foreground transition-colors"
          >
            Privacy Policy
          </Link>
          <Link
            href="/terms"
            className="hover:text-foreground transition-colors"
          >
            Terms of Service
          </Link>
          <span>© 2026 Telegram for GHL</span>
        </footer>
      </div>
    </main>
  );
}
