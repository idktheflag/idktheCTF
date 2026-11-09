import { apiFetch } from "@/lib/api";
import { AuthProvider } from "@/AuthContext";
import { useAuth } from "@/auth-context";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Navbar } from "@/components/layout/Navbar";
import { getBackendURL } from "@/lib/utils";
import React, { Suspense } from "react";
import { Navigate, Outlet, Route, BrowserRouter as Router, Routes, useLocation } from "react-router-dom";

const Login = React.lazy(() => import("@/pages/Login").then((m) => ({ default: m.Login })));
const Register = React.lazy(() => import("@/pages/Register").then((m) => ({ default: m.Register })));
const SendEmail = React.lazy(() => import("@/pages/SendEmail"));
const RequestPasswordReset = React.lazy(() => import("@/pages/RequestPasswordReset"));
const CompletePasswordReset = React.lazy(() => import("@/pages/CompletePasswordReset"));
const VerifyEmail = React.lazy(() => import("@/pages/VerifyEmail"));
const AdminDashboard = React.lazy(() => import("@/pages/admin/AdminDashboard").then((m) => ({ default: m.AdminDashboard })));
const Challenges = React.lazy(() => import("@/pages/user/Challenges").then((m) => ({ default: m.Challenges })));
const Home = React.lazy(() => import("@/pages/user/Home").then((m) => ({ default: m.Home })));
const LeaderBoard = React.lazy(() => import("@/pages/user/LeaderBoard").then((m) => ({ default: m.LeaderBoard })));
const Personal = React.lazy(() => import("@/pages/user/Personal"));
const Profile = React.lazy(() => import("@/pages/user/Profile").then((m) => ({ default: m.Profile })));
const Teams = React.lazy(() => import("@/pages/user/Teams").then((m) => ({ default: m.Teams })));
const TeamProfile = React.lazy(() => import("@/pages/user/TeamProfile").then((m) => ({ default: m.TeamProfile })));
const EventSettings = React.lazy(() => import("@/pages/admin/EventSettings").then((m) => ({ default: m.EventSettings })));
const TeamsAdmin = React.lazy(() => import("@/pages/admin/TeamsAdmin").then((m) => ({ default: m.TeamsAdmin })));
const UsersAdmin = React.lazy(() => import("@/pages/admin/UsersAdmin").then((m) => ({ default: m.UsersAdmin })));
const LogsAdmin = React.lazy(() => import("@/pages/admin/LogsAdmin").then((m) => ({ default: m.LogsAdmin })));
const ContentAdmin = React.lazy(() => import("@/pages/admin/ContentAdmin").then((m) => ({ default: m.ContentAdmin })));
const ContentPage = React.lazy(() => import("@/pages/user/ContentPage").then((m) => ({ default: m.ContentPage })));

const PublicLayout: React.FC = () => <>
  <Navbar />
  <div className="container mx-auto p-4"><Suspense fallback={<div className="p-8 text-center">Loading page…</div>}><Outlet /></Suspense></div>
</>;

export const TeamRequired: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [state, setState] = React.useState<"checking" | "ready" | "team" | "error">("checking");
  const [attempt, setAttempt] = React.useState(0);
  React.useEffect(() => {
    if (!user) { setState("ready"); return; }
    if (!user.emailVerified) { setState("ready"); return; }
    if (user.isAdmin) { setState("ready"); return; }
    const controller = new AbortController();
    setState("checking");
    apiFetch(`${getBackendURL()}/api/teams/me`, { signal: controller.signal, headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })
      .then((r) => { if (!r.ok) throw new Error("Membership unavailable"); return r.json(); })
      .then((data) => { if (!controller.signal.aborted) setState(data.team ? "ready" : "team"); })
      .catch(() => { if (!controller.signal.aborted) setState("error"); });
    return () => controller.abort();
  }, [user, attempt]);
  if (state === "checking") return <div className="p-8 text-center">Checking team membership…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.emailVerified) return <Navigate to="/send-email" replace />;
  if (state === "error") return <div role="alert" className="p-8 text-center"><p>Could not check team membership. Please try again.</p><button className="mt-4 underline" onClick={() => setAttempt((value) => value + 1)}>Retry</button></div>;
  if (state === "team") return <Navigate to="/teams" replace />;
  return <>{children}</>;
};

const AppContent: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();
  const adminPath = location.pathname.startsWith("/admin");
  return <div className="dark min-h-screen bg-background text-foreground">
    {!adminPath && <div className="min-h-screen bg-background text-foreground">
      <Routes>
        <Route element={<PublicLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/pages/:slug" element={<ContentPage />} />
          <Route path="/users" element={<Navigate to="/teams" replace />} />
          <Route path="/teams" element={<Teams />} />
          <Route path="/team/:teamId" element={<TeamProfile />} />
          <Route path="/challenges" element={<TeamRequired><Challenges /></TeamRequired>} />
          <Route path="/leaderboard" element={<LeaderBoard />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/login" element={<Login />} />
          <Route path="/reset-password" element={<RequestPasswordReset />} />
          <Route path="/reset-password/complete" element={<CompletePasswordReset />} />
          <Route path="/register" element={<Register />} />
          <Route path="/personal/:userId" element={<Personal />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/send-email" element={<SendEmail />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </div>}
    {adminPath && <Routes>
      <Route path="/admin" element={user?.isAdmin ? <AdminLayout /> : <Navigate to="/login" replace />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<AdminDashboard />} />
        <Route path="challenges" element={<Challenges />} />
        <Route path="challenges/create" element={<Navigate to="/admin/challenges" replace />} />
        <Route path="challenges/edit" element={<Navigate to="/admin/challenges" replace />} />
        <Route path="event" element={<EventSettings />} />
        <Route path="teams" element={<TeamsAdmin />} />
        <Route path="users" element={<UsersAdmin />} />
        <Route path="logs" element={<LogsAdmin />} />
        <Route path="content" element={<ContentAdmin />} />
        <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
      </Route>
    </Routes>}
  </div>;
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <Router><AppContent /></Router>
    </AuthProvider>
  );
};

export default App;

