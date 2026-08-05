import { Logo } from "@/components/Logo";
import type { Metadata } from "next";
import { legalHref } from "@/lib/runtime";

export const metadata: Metadata = { title: "Support — Trifecta" };

const EMAIL = "ryan.helou@gmail.com";

/*
  Guideline 1.5 (Developer Information): "Make sure your app and its Support URL include
  an easy way to contact you." The Support URL in App Store Connect used to point at the
  app's root — i.e. at a login screen, with no contact route and nothing a stuck user
  could do. This page is the Support URL, and it is also linked from Profile so the "and
  your app" half of that sentence is satisfied too.

  Kept deliberately plain and static: it has to render for someone who is signed out,
  offline in the bundled app, or opening the link from the App Store listing.
*/
export default function Support() {
  return (
    <main
      className="mx-auto max-w-2xl px-5 pb-12 text-[0.95rem] leading-relaxed text-foreground"
      /* These pages render OUTSIDE the app shell, so nothing else applies the notch
         inset for them: on an iPhone 17 Pro Max the "Back to Trifecta" link sat half
         under the status bar, unreadable and awkward to tap. */
      style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 2rem)" }}
    >
      {/* A real anchor, not next/link: this page is also served as a standalone
          support_url.txt destination and is loaded inside the bundled app as
          support.html, where a full document load back to "/" is the behaviour we
          actually want (and have tested) rather than a client-side route change. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/" className="text-sm text-muted underline">← Back to Trifecta</a>
      {/* The mark, because this page is the App Store Support URL: a reviewer (and a
          stuck user) arrives here from the listing, and an unbranded wall of text
          doesn't obviously belong to the app they just tapped away from. */}
      <div className="mt-6"><Logo size={20} className="text-lg" /></div>
      <h1 className="mt-3 text-2xl font-semibold">Support</h1>
      <p className="mt-1 text-sm text-muted">Adaptive triathlon coaching</p>

      <Section title="Contact us">
        <p>
          Email <a className="underline" href={`mailto:${EMAIL}`}>{EMAIL}</a> and a human will
          answer. Include your username and, if something went wrong, what you were doing when it
          happened — it makes the fix much faster.
        </p>
      </Section>

      <Section title="Common questions">
        <Q q="How do I change my race, my training days, or my equipment?">
          Profile → <b>Edit race &amp; training settings</b>. The plan rebuilds around the change;
          sessions you have already completed stay completed.
        </Q>
        <Q q="A session doesn't fit my week. Can I move it?">
          Yes — open the session and move it to another day, or use Profile → <b>Rebuild plan
          around today</b> if your week has drifted a long way from the plan.
        </Q>
        <Q q="I'm carrying a niggle. What do I do?">
          Tell the app. It eases load on the affected sport and trains around it rather than
          dropping you to zero. Pain that is sharp, worsening, or present at rest is a doctor
          question, not an app question — Trifecta is training guidance, not medical advice.
        </Q>
        <Q q="How do I connect Apple Health?">
          Profile → <b>Apple Health</b> → <b>Sync with Apple Health</b>. iOS asks your permission
          the first time. Trifecta only reads workouts; it never writes to Apple Health, and the
          matching happens on your iPhone.
        </Q>
        <Q q="How do I delete my account?">
          Profile → <b>Delete account</b>. It erases your account and all associated data
          immediately and irreversibly.
        </Q>
        <Q q="My workouts aren't auto-completing.">
          Check Profile → Apple Health or the Strava connection, and confirm the workout&apos;s sport
          and date match a planned session. If it still doesn&apos;t match, email us with the date and
          the sport.
        </Q>
      </Section>

      <Section title="Privacy and terms">
        <p>
          <a className="underline" href={legalHref("/privacy")}>Privacy Policy</a>
          <span className="px-2">·</span>
          <a className="underline" href={legalHref("/terms")}>Terms of Use</a>
        </p>
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

function Q({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <div className="font-medium text-foreground">{q}</div>
      <p className="mt-1">{children}</p>
    </div>
  );
}
