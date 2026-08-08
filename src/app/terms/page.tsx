import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export const metadata = {
  title: "Terms of Service | Telegram Bridge",
};

export default function TermsPage() {
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
          Terms of <span className="text-primary">Service</span>
        </h1>
        
        <div className="text-muted-foreground w-full space-y-6">
          <p className="font-medium text-foreground">Last Updated: April 25, 2026</p>
          
          <h2 className="text-2xl font-semibold text-foreground mt-8 mb-4">1. Acceptance of Terms</h2>
          <p>
            By installing and using Telegram Bridge, you agree to be bound by these Terms of Service.
            If you do not agree, please do not use the application.
          </p>

          <h2 className="text-2xl font-semibold text-foreground mt-8 mb-4">2. Description of Service</h2>
          <p>
            The Service connects your sub-account to one or more Telegram bots, or to a
            Telegram account via phone-number login (a &quot;Phone Account&quot;), enabling two-way
            messaging between Telegram and your Inbox. We provide the software &quot;as is&quot;
            and make no guarantees regarding uptime or specific performance outcomes.
          </p>

          <h2 className="text-2xl font-semibold text-foreground mt-8 mb-4">3. User Obligations</h2>
          <p>
            You are responsible for the content of messages sent and received through the Service, and
            for complying with Telegram&apos;s own Terms of Service and any applicable messaging or data
            protection regulations. You must not use the Service for any illegal or unauthorized purpose.
          </p>

          <h2 className="text-2xl font-semibold text-foreground mt-8 mb-4">4. Intellectual Property</h2>
          <p>
            The software is released under the MIT License. You are free to use, modify, and distribute the software in accordance with the license terms.
          </p>

          <h2 className="text-2xl font-semibold text-foreground mt-8 mb-4">5. Limitation of Liability</h2>
          <p>
            We shall not be liable for any direct, indirect, incidental, or consequential damages resulting from the use or inability to use the service.
          </p>

          <h2 className="text-2xl font-semibold text-foreground mt-8 mb-4">6. Termination</h2>
          <p>
            We reserve the right to terminate or suspend access to our service immediately, without prior notice, for any reason whatsoever.
          </p>
        </div>
      </div>
    </main>
  );
}
