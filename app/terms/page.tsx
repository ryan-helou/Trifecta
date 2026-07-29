import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms of Service — Trifecta" };

const UPDATED = "23 July 2026";

export default function Terms() {
  return (
    <main
      className="mx-auto max-w-2xl px-5 pb-12 text-[0.95rem] leading-relaxed text-foreground"
      /* These pages render OUTSIDE the app shell, so nothing else applies the notch
         inset for them: on an iPhone 17 Pro Max the "Back to Trifecta" link sat half
         under the status bar, unreadable and awkward to tap. */
      style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 2rem)" }}
    >
      <a href="/" className="text-sm text-muted underline">← Back to Trifecta</a>
      <h1 className="mt-6 text-2xl font-semibold">Terms of Service</h1>
      <p className="mt-1 text-sm text-muted">Last updated {UPDATED}</p>

      <p className="mt-6">By creating an account or using Trifecta, you agree to these terms.</p>

      <Section title="Not medical advice">
        <p>
          Trifecta generates training guidance from the information you provide. It is <b>not medical
          advice</b> and is not a substitute for a doctor, physiotherapist, or qualified coach.
          Training carries risk of injury; you take part at your own risk. If you feel pain, illness,
          or anything concerning, stop and consult a professional. Get medical clearance before
          starting a new training program.
        </p>
      </Section>

      <Section title="Your account">
        <p>You’re responsible for keeping your login secure and for the activity on your account. Provide accurate information so the plan can be built sensibly.</p>
      </Section>

      <Section title="Acceptable use">
        <p>Don’t misuse the service — no attempts to break, overload, or gain unauthorized access to it, and no using it to harm others.</p>
      </Section>

      <Section title="No warranty">
        <p>The app is provided “as is”, without warranties of any kind. We don’t guarantee it will be uninterrupted, error-free, or that plans will produce a particular result.</p>
      </Section>

      <Section title="Limitation of liability">
        <p>To the maximum extent permitted by law, Trifecta and its maker are not liable for any injury, loss, or damages arising from your use of the app.</p>
      </Section>

      <Section title="Termination">
        <p>You can delete your account at any time from <span className="whitespace-nowrap">Profile → Delete account</span>. We may suspend accounts that abuse the service.</p>
      </Section>

      <Section title="Changes">
        <p>We may update these terms; continued use after an update means you accept the new version.</p>
      </Section>

      <Section title="Contact">
        <p><a className="underline" href="mailto:ryan.helou@gmail.com">ryan.helou@gmail.com</a>.</p>
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
