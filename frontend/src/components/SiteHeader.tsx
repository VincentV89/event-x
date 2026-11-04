import { Link } from 'react-router-dom';

export default function SiteHeader({ dark = true }: { dark?: boolean }) {
  return (
    <header className={`relative z-10 ${dark ? 'text-white' : 'text-slate-900'}`}>
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5" aria-label="Main">
        <Link to="/" className="flex items-center gap-2 no-underline" style={{ color: 'inherit', textDecoration: 'none' }}>
          <img src="/favicon.svg" alt="" className="h-9 w-9" />
          <span className="text-xl font-bold tracking-tight">Event<span className="text-cyan-300">X</span></span>
        </Link>
        <div className="flex items-center gap-6 text-sm font-medium">
          <a href="#about" className="hidden sm:inline" style={{ color: 'inherit', textDecoration: 'none' }}>About</a>
          <a href="#agenda" className="hidden sm:inline" style={{ color: 'inherit', textDecoration: 'none' }}>Agenda</a>
          <a href="#register" className="hidden sm:inline" style={{ color: 'inherit', textDecoration: 'none' }}>Register</a>
          <Link
            to="/organizer"
            className="rounded-full border border-white/30 px-4 py-2 hover:bg-white/10"
            style={{ color: 'inherit', textDecoration: 'none' }}
          >
            Organizer login
          </Link>
        </div>
      </nav>
    </header>
  );
}
