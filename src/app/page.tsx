// loading-exempt: static landing page — no server data fetching.
import Link from "next/link";
import { BookOpenText, PenLine, Users } from "lucide-react";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { siteConfig } from "@/lib/site";

const features = [
  {
    icon: BookOpenText,
    title: "Read at your own pace",
    body: "A calm, distraction-free reader for Scripture — no clutter, no pressure. Just you and the text.",
  },
  {
    icon: PenLine,
    title: "Study like a document",
    body: "Capture notes, questions, and reflections in a familiar word-processor. Your study, organized into sections you can return to anytime.",
  },
  {
    icon: Users,
    title: "Never study alone",
    body: "Join a group study and see what others are noticing in real time. Encouragement and insight, built right in.",
  },
] as const;

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto w-full max-w-6xl px-4 py-20 sm:py-28">
          <div className="mx-auto max-w-3xl text-center">
            <p className="mb-4 text-caption font-semibold tracking-wide text-primary uppercase">
              {siteConfig.tagline}
            </p>
            <h1 className="text-display font-bold tracking-tight text-balance sm:text-display-xl">
              The Bible, made approachable.
            </h1>
            <p className="mt-6 text-subheading text-pretty text-muted-foreground sm:text-heading">
              {siteConfig.description} No prior knowledge needed — just bring
              your curiosity.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/signup">Start your first study</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/login">I already have an account</Link>
              </Button>
            </div>
          </div>

          {/* Scripture quote, set in the serif reading face */}
          <figure className="mx-auto mt-16 max-w-2xl border-l-4 border-primary pl-6">
            <blockquote className="font-serif text-heading leading-relaxed text-pretty sm:text-title">
              “Your word is a lamp to my feet and a light to my path.”
            </blockquote>
            <figcaption className="mt-3 text-caption text-muted-foreground">
              Psalm 119:105
            </figcaption>
          </figure>
        </section>

        {/* Features */}
        <section className="border-y border-border/60 bg-muted/40">
          <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-16 sm:grid-cols-3">
            {features.map((feature) => (
              <Card key={feature.title} className="border-border/60 bg-card/60">
                <CardHeader>
                  <feature.icon className="size-8 text-primary" aria-hidden />
                  <CardTitle className="mt-2 text-heading">
                    {feature.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-muted-foreground">
                  {feature.body}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Closing call to action */}
        <section className="mx-auto w-full max-w-6xl px-4 py-20 text-center">
          <h2 className="text-page-title font-bold tracking-tight text-balance sm:text-display">
            Take the first step today.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-subheading text-pretty text-muted-foreground">
            Create a free account and open your first study in minutes.
          </p>
          <Button asChild size="lg" className="mt-8">
            <Link href="/signup">Get started — it’s free</Link>
          </Button>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
