import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy Policy — Trifecta" };

const UPDATED = "29 July 2026";

export default function PrivacyPolicy() {
  return (
    <main
      className="mx-auto max-w-2xl px-5 pb-12 text-[0.95rem] leading-relaxed text-foreground"
      /* These pages render OUTSIDE the app shell, so nothing else applies the notch
         inset for them: on an iPhone 17 Pro Max the "Back to Trifecta" link sat half
         under the status bar, unreadable and awkward to tap. */
      style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 2rem)" }}
    >
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
          <li>
            <b>Apple Health (optional):</b> only if you grant access, and read-only. We request
            exactly one HealthKit type — <b>workouts</b> — and from each workout we use its
            sport, start time, duration and distance to match it to a planned session. We do not
            request or read heart rate, sleep, body measurements, clinical records, or anything
            else. Workouts are read and matched <b>on your iPhone</b>; the health data itself is
            <b> never uploaded to our servers</b>, and only the resulting “session completed” is
            synced. Trifecta <b>never writes to Apple Health</b>.
          </li>
          <li><b>AI features (optional, off by default):</b> nothing about your body is sent anywhere unless you switch on <b>Analyse my injury notes with AI</b> — a separate choice from accepting these terms, which you can withdraw at any time in <span className="whitespace-nowrap">Profile → AI features</span>. With it on, the text you type about aches and injuries is sent to <b>Google (Gemini)</b> to turn into training limits, and the AI coach may be told which areas you are training around. With it off, neither happens and the on-device safety check still runs. We only send health text to a no-training tier, so it is not used to improve their models.</li>
        </ul>
      </Section>

      <Section title="Health data — what we never do with it">
        <p>
          Health and fitness data is treated as sensitive, and Apple’s rules for it are strict. We
          hold ourselves to them explicitly: data read from Apple Health, and the training and
          injury information you enter, is <b>never</b> used for advertising, marketing, or
          use-based data mining, and it is never sold or shared with data brokers — by us or by
          anyone we work with. We do not store personal health information in iCloud. It is used
          for one thing: building and adapting your training plan for you.
        </p>
      </Section>

      <Section title="How we use it">
        <p>To build and adapt your training plan, show your progress, and — if you use the social features — show your username and workout summaries to people you connect with. That’s it.</p>
      </Section>

      <Section title="Storage & security">
        <p>Data is encrypted in transit (HTTPS/TLS) and stored in our database (hosted on Railway). Passwords are hashed with scrypt. Apple Health data stays on your device.</p>
      </Section>

      <Section title="Who we share with">
        <p>Only the services needed to run the app: our hosting provider (Railway), Strava (only if you connect it), and <b>Google (Gemini)</b> as our AI provider (only for the optional AI features, and only when you tap). No advertisers. No data brokers.</p>
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
