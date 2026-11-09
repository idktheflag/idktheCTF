import { apiFetch } from "@/lib/api";
import { useAuth } from "@/auth-context";
import { Button } from "@/components/ui/button";
import { getBackendURL } from "@/lib/utils";
import { CircleHelp, FileText, Flag, LayoutDashboard, Logs, LogOut, Menu, Settings2, Users, X } from "lucide-react";
import React, { Suspense, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";

const navigation = [
  { label: "Overview", to: "/admin/dashboard", icon: LayoutDashboard, end: true },
  { label: "Challenges", to: "/admin/challenges", icon: Flag, end: true },
  { label: "Teams", to: "/admin/teams", icon: Users },
  { label: "Participants", to: "/admin/users", icon: Users },
  { label: "Activity log", to: "/admin/logs", icon: Logs },
  { label: "Announcements & pages", to: "/admin/content", icon: FileText },
  { label: "Event settings", to: "/admin/event", icon: Settings2 },
];

const isCurrentItem = (path: string, item: { to: string; end?: boolean }) => {
  if (item.to === "/admin/challenges") return path === item.to || path.startsWith("/admin/challenges/edit");
  return item.end ? path === item.to : path === item.to || path.startsWith(`${item.to}/`);
};

export const AdminLayout: React.FC = () => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [event, setEvent] = useState<{ name: string; phase: string } | null>(null);
  useEffect(() => {
    apiFetch(`${getBackendURL()}/api/event`).then((response) => response.json()).then((data) => {
      if (data.initialized) setEvent({ name: data.name, phase: data.phase });
    }).catch(() => setEvent(null));
  }, []);
  useEffect(() => setMenuOpen(false), [location.pathname]);

  const sidebar = <aside className="flex h-full w-[264px] shrink-0 flex-col border-r border-border bg-background text-foreground md:sticky md:top-0 md:h-screen">
    <div className="border-b border-border px-5 py-5">
      <Link to="/" className="flex items-center gap-3" onClick={() => setMenuOpen(false)}>
        <img src="/branding/web-app-manifest-192x192.png" alt="" className="h-10 w-10 rounded-md bg-card p-0.5" />
        <span><span className="block font-mono text-lg font-semibold tracking-tight"><span className="text-primary">idk</span>theCTF</span><span className="block text-xs text-muted-foreground">Organizer console</span></span>
      </Link>
      {event && <div className="mt-5 border-t border-border pt-4"><p className="truncate text-sm font-semibold">{event.name}</p><p className="mt-1 flex items-center gap-2 text-xs capitalize text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-foreground" />{event.phase} event</p></div>}
    </div>
    <nav aria-label="Admin navigation" className="flex-1 space-y-1 overflow-y-auto px-3 py-5">
      <p className="mb-2 px-3 text-xs font-medium text-muted-foreground">Event management</p>
      {navigation.map(({ label, to, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={() => `flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors ${isCurrentItem(location.pathname, { to, end }) ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-accent hover:text-accent-foreground"}`}>
        <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
      </NavLink>)}
    </nav>
    <div className="border-t border-border p-3">
      <Link to="/" className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-foreground hover:bg-accent"><CircleHelp size={17} />View public site</Link>
      <div className="mt-2 flex items-center gap-3 border-t border-border px-2 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground">{(user?.email || "A").slice(0, 1).toUpperCase()}</span>
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{user?.email || "Administrator"}</span><span className="block text-xs text-muted-foreground">Administrator</span></span>
        <button type="button" title="Log out" aria-label="Log out" onClick={logout} className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"><LogOut size={16} /></button>
      </div>
    </div>
  </aside>;

  return <div className="min-h-screen bg-background text-foreground">
    {menuOpen && <button className="fixed inset-0 z-20 bg-black/40 md:hidden" aria-label="Close admin menu" onClick={() => setMenuOpen(false)} />}
    <div className="flex min-h-screen">
      <div className="hidden md:block">{sidebar}</div>
      {menuOpen && <div className="fixed inset-y-0 left-0 z-50 md:hidden">{sidebar}</div>}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background px-4 sm:px-7">
          <div className="flex items-center gap-3"><Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMenuOpen((open) => !open)} aria-label={menuOpen ? "Close menu" : "Open menu"}>{menuOpen ? <X size={20} /> : <Menu size={20} />}</Button><p className="text-sm font-semibold">Administration</p></div>
          <div className="flex items-center gap-2"><span className="hidden rounded-md border border-border px-3 py-1.5 font-mono text-xs text-muted-foreground sm:inline">idktheCTF / organizer</span></div>
        </header>
        <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8"><Suspense fallback={<div className="p-8 text-center text-sm text-muted-foreground">Loading organizer tools…</div>}><Outlet /></Suspense></main>
      </div>
    </div>
  </div>;
};

