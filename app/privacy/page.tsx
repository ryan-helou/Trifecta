import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy Policy — Trifecta" };

const UPDATED = "23 July 2026";

export default function PrivacyPolicy() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-12 text-[0.95rem] leading-relaxed text-foreground">
      <a href="/" className="text-sm text-muted underline">← Back to Trifecta</a>
      <h1 className="mt-6 text-2xl font-semibold">Privacy Policy</h1>
      <p className="mt-1 text-sm text-muted">Last updated {UPDATED}</p>

      <p className="mt-6">
        Trifecta is a triathlon training app. This policy explains what we collect, why, and the
        control you have. We keep data collection to what the app actually needs, and we never sell
        your data or use it for advertising.
      </p>

      <Section title="What we collect">
        <ul className="ml-5 list-disc space-y-1.5">
          <li><b>Account:</b> your username and a securely hashed password (we never store the plain password).</li>
          <li><b>Training data:</b> the profile you enter (goals, experience, PRs, injuries, availability) and your generated plan, workouts, and completions — this is what the app adapts your plan from.</li>
          <li><b>Strava (optional):</b> only if you connect it. We store access tokens and pull your recent activities to auto-complete matching planned sessions.</li>
          <li><b>Apple Health (optional):</b> only if you grant access. Your health workouts are read <b>on your device</b> and matched to your plan there — the raw health data is <b>not uploaded</b>; only the resulting workout completion syncs.</li>
          <li><b>AI coach (optional):</b> if enabled, the training context shown to you is sent to our AI provider to generate a short note. Your data is not used to train their models.</li>
        </ul>
      </Section>

      <Section title="How we use it">
        <p>To build and adapt your training plan, show your progress, and — if you use the social features — show your username and workout summaries to people you connect with. That’s it.</p>
      </Section>

      <Section title="Storage & security">
        <p>Data is encrypted in transit (HTTPS/TLS) and stored in our database (hosted on Railway). Passwords are hashed with scrypt. Apple Health data stays on your device.</p>
      </Section>

      <Section title="Who we share with">
        <p>Only the services needed to run the app: our hosting provider (Railway), Strava (only if you connect it), and our AI provider (only if the coach is enabled). No advertisers. No data brokers.</p>
      </Section>

      <Section title="Your rights">
        <p>You can view and edit your data in the app at any time, and you can <b>permanently delete your account and all associated data</b> from <span className="whitespace-nowrap">Profile → Delete account</span>. Deletion is immediate and irreversible. For anything else, email us.</p>
      </Section>

      <Section title="Retention">
        <p>We keep your data until you delete your account, after which it is erased.</p>
      </Section>

      <Section title="Contact">
        <p>Questions or requests: <a className="underline" href="mailto:ryan.helou@gmail.com">ryan.helou@gmail.com</a>.</p>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-2 space-y-2 text-muted">{children}</div>
    </section>
  );
}
