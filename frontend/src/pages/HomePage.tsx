import { useCallback, useEffect, useState } from 'react';
import Alert from '@cloudscape-design/components/alert';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import ProgressBar from '@cloudscape-design/components/progress-bar';
import Spinner from '@cloudscape-design/components/spinner';
import SiteHeader from '../components/SiteHeader';
import RegistrationForm from '../components/RegistrationForm';
import { api, formatDateRange, type EventSummary } from '../lib/api';

const AGENDA = [
  { time: '09:00', title: 'Opening keynote: Building the Singapore Government Tech Stack', track: 'Keynote' },
  { time: '10:30', title: 'Serverless at national scale - lessons from production', track: 'Cloud' },
  { time: '11:45', title: 'Responsible GenAI for public services', track: 'AI' },
  { time: '14:00', title: 'Zero-trust architecture and secure-by-design delivery', track: 'Security' },
  { time: '15:30', title: 'Design systems that scale across 100+ agencies', track: 'Design' },
  { time: '17:00', title: 'Fireside chat & networking reception', track: 'Community' },
];

const TRACK_COLORS: Record<string, string> = {
  Keynote: 'bg-violet-100 text-violet-800', Cloud: 'bg-sky-100 text-sky-800', AI: 'bg-fuchsia-100 text-fuchsia-800',
  Security: 'bg-amber-100 text-amber-800', Design: 'bg-emerald-100 text-emerald-800', Community: 'bg-slate-200 text-slate-800',
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass rounded-2xl px-5 py-4">
      <div className="text-xs uppercase tracking-widest text-cyan-200/80">{label}</div>
      <div className="mt-1 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

export default function HomePage() {
  const [event, setEvent] = useState<EventSummary>();
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const events = await api.listEvents();
      if (!events.length) throw new Error('No events are currently open.');
      setEvent(await api.getEvent(events[0].eventId));
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <div className="min-h-screen">
      {/* Banner */}
      <section className="hero-bg relative overflow-hidden pb-24">
        <div className="grid-overlay pointer-events-none absolute inset-0" />
        <SiteHeader />
        <div className="relative mx-auto grid max-w-7xl gap-12 px-6 pt-10 lg:grid-cols-[1.3fr_1fr] lg:pt-16">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-cyan-400/15 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-cyan-200 ring-1 ring-cyan-300/30">
              <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-300" /> Registration open
            </span>
            <h1 className="mt-6 text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-6xl">
              {event?.name ?? 'GovTech Stack X Conference 2026'}
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-slate-200/90">
              {event?.tagline ?? 'Where public-sector builders shape the next generation of digital government.'}
            </p>
            <div className="mt-8 grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
              <Stat label="Date" value={event ? formatDateRange(event.startDate, event.endDate) : '…'} />
              <Stat label="Venue" value={event?.venue ?? '…'} />
              <Stat label="Capacity" value={event ? `${event.capacity} attendees` : '…'} />
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#register" className="rounded-full bg-gradient-to-r from-cyan-400 to-violet-500 px-7 py-3 font-semibold text-white shadow-lg shadow-violet-900/40 hover:opacity-95" style={{ textDecoration: 'none', color: 'white' }}>
                Register now →
              </a>
              <a href="#agenda" className="rounded-full border border-white/30 px-7 py-3 font-semibold text-white hover:bg-white/10" style={{ textDecoration: 'none', color: 'white' }}>
                View agenda
              </a>
            </div>
          </div>
          <div className="floaty glass hidden self-center rounded-3xl p-8 text-white lg:block" aria-label="Live seat availability">
            <div className="text-sm uppercase tracking-widest text-cyan-200/80">Seats remaining</div>
            <div className="mt-2 text-7xl font-extrabold">{event ? event.availableSeats : '–'}</div>
            <div className="text-slate-300">of {event?.capacity ?? 300} total</div>
            <div className="mt-6 h-3 w-full overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-violet-400 transition-all" style={{ width: `${event?.capacityPercent ?? 0}%` }} />
            </div>
            <div className="mt-2 text-sm text-slate-300">{event ? `${event.capacityPercent}% booked · ${event.registeredCount} registered` : 'Loading…'}</div>
          </div>
        </div>
      </section>

      <main className="relative z-10">
        {/* Grid lives on a div: Cloudscape's unlayered base CSS sets main { display: block } which would override Tailwind's layered utilities. */}
        <div className="mx-auto -mt-14 grid max-w-7xl gap-8 px-6 pb-20 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-8">
          {error && <Alert type="error" header="Unable to load event">{error}</Alert>}
          <section id="about">
            <Container header={<Header variant="h2" description={event ? `${event.venue}${event.city ? `, ${event.city}` : ''}` : undefined}>About the conference</Header>}>
              {event ? (
                <div className="space-y-5">
                  <p className="text-base leading-7 text-slate-700">{event.description}</p>
                  {!!event.highlights?.length && (
                    <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
                      {event.highlights.map((h) => (
                        <li key={h} className="flex items-start gap-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
                          <span className="mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-violet-500 text-xs text-white">✓</span>
                          {h}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <Spinner />
              )}
            </Container>
          </section>
          <section id="agenda">
            <Container header={<Header variant="h2" description="Day 1 highlights">Agenda</Header>}>
              <ol className="m-0 list-none divide-y divide-slate-100 p-0">
                {AGENDA.map((a) => (
                  <li key={a.time} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:gap-6">
                    <span className="w-16 font-mono text-sm font-semibold text-slate-500">{a.time}</span>
                    <span className="flex-1 font-medium text-slate-800">{a.title}</span>
                    <span className={`w-fit rounded-full px-3 py-0.5 text-xs font-semibold ${TRACK_COLORS[a.track]}`}>{a.track}</span>
                  </li>
                ))}
              </ol>
            </Container>
          </section>
        </div>

        <aside id="register" className="lg:sticky lg:top-6 lg:self-start">
          <Container header={<Header variant="h2" description="Free for public-sector and industry partners">Register</Header>}>
            {event ? (
              <div className="space-y-6">
                <ProgressBar
                  value={event.capacityPercent}
                  label="Seats booked"
                  description={`${event.availableSeats} of ${event.capacity} seats available`}
                  additionalInfo={event.availableSeats < 30 && event.availableSeats > 0 ? 'Almost full - register soon!' : undefined}
                />
                <RegistrationForm event={event} onRegistered={refresh} />
              </div>
            ) : (
              <Spinner />
            )}
          </Container>
        </aside>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white py-8 text-center text-sm text-slate-500">
        © 2026 EventX · Built on AWS serverless · <a href="/organizer">Organizer portal</a>
      </footer>
    </div>
  );
}
