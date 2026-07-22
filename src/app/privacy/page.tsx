import { buttonVariants } from "@/components/ui/button";
import Link from "next/link";

export const metadata = {
  title: "Privacy Policy | Telegram for GHL",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen flex flex-col items-center p-8 pt-16 bg-background relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute top-0 inset-x-0 h-64 bg-linear-to-b from-primary/5 to-transparent pointer-events-none" />

      <div className="max-w-3xl w-full flex flex-col items-start text-left z-10">
        <Link
          href="/"
          className={buttonVariants({ variant: "outline", className: "mb-8" })}
        >
          ← Back to Home
        </Link>

        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-4">
          Privacy <span className="text-primary">Policy</span>
        </h1>

        <div className="text-muted-foreground w-full space-y-6">
          <p className="font-medium text-foreground">
            Last Updated: April 25, 2026
          </p>

          <h2 className="text-2xl font-semibold text-foreground mt-8 mb-4">
            1. Introduction
          </h2>
          <p>
            This Privacy Policy explains how we collect, use, and protect your
            information when you use Telegram for GHL. We are committed to
            ensuring that your privacy is protected and that we comply with all
            relevant data protection laws.
          </p>

          <h2 className="text-2xl font-semibold text-foreground mt-8 mb-4">
            2. Information We Collect
          </h2>
          <p>
            To provide our services, we may collect the following information:
          </p>
          <ul className="list-disc pl-6 space-y-2 mt-2">
            <li>
              <strong className="text-foreground">
                CRM Account Information:
              </strong>{" "}
              When you connect your sub-account, we receive an OAuth token and
              basic location details (ID, name).
            </li>
            <li>
              <strong className="text-foreground">Telegram Bot &amp; Message Data:</strong>{" "}
              The Telegram bot tokens you connect, and the Telegram user ID, username, and name
              of anyone who messages a connected bot, along with the messages relayed between
              Telegram and your GHL Inbox.
            </li>
            <li>
              <strong className="text-foreground">Phone Account Data:</strong>{" "}
              If you connect a Telegram account via phone-number login, we store that account&apos;s
              phone number and the session credential used to keep it connected, along with the
              Telegram user ID, username, and name of anyone who messages that account in a DM,
              group, or channel, and the messages relayed between Telegram and your GHL Inbox.
            </li>
          </ul>

          <h2 className="text-2xl font-semibold text-foreground mt-8 mb-4">
            3. How We Use Your Information
          </h2>
          <p>
            We use your information exclusively to relay messages between Telegram and your
            GoHighLevel Inbox, and to create or match GHL contacts for people who message your
            bots or Phone Accounts.
            <strong className="text-foreground">
              {" "}
              We do not sell your data to third parties.
            </strong>
          </p>

          <h2 className="text-2xl font-semibold text-foreground mt-8 mb-4">
            4. Data Storage
          </h2>
          <p>
            Your CRM session tokens, connected Telegram bot tokens, Phone Account session
            credentials, and a log of relayed messages are stored securely in our database to
            allow the application to function. You can revoke access at any time through the
            marketplace, and can disconnect individual Telegram bots or Phone Accounts at any
            time from the dashboard.
          </p>

          <h2 className="text-2xl font-semibold text-foreground mt-8 mb-4">
            5. Contact Us
          </h2>
          <p>
            If you have any questions about this Privacy Policy, please reach out through the
            support channel listed in this app&apos;s GoHighLevel Marketplace listing.
          </p>
        </div>
      </div>
    </main>
  );
}
