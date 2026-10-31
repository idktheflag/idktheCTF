import { User, useAuth } from "@/AuthContext";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Flag,
  LogIn,
  LogOut,
  Menu,
  Settings,
  Trophy,
  UserIcon,
  UserRoundPlus,
  Users,
  X,
} from "lucide-react";
import React, { useState } from "react";
import { Link } from "react-router-dom";

export const Navbar: React.FC = () => {
  const { user, logout } = useAuth();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const toggleMenu = () => setIsMenuOpen(!isMenuOpen);

  const NavLink: React.FC<{
    to: string;
    icon: React.ReactNode;
    children: React.ReactNode;
  }> = ({ to, icon, children }) => (
    <Link
      to={to}
      className="flex items-center space-x-2 text-muted-foreground hover:text-foreground text-muted-foreground dark:hover:text-foreground"
      onClick={() => setIsMenuOpen(false)}
    >
      {icon}
      <span>{children}</span>
    </Link>
  );

  return (
      <nav className="border-b border-border bg-background px-4 py-3">
      <div className="container mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link
              className="flex items-center gap-2 font-mono text-lg font-semibold tracking-tight text-foreground"
              to="/"
            >
              <img src="/branding/web-app-manifest-192x192.png" alt="" className="h-8 w-8 rounded-md bg-card p-0.5" />
              <span><span className="text-primary">idk</span>theCTF</span>
            </Link>

            {/* Left-side navigation items (visible on md and above) */}
            <div className="hidden items-center space-x-4 md:flex">
              <NavLink to="/teams" icon={<Users size={20} />}>
                Teams
              </NavLink>
              <NavLink to="/leaderboard" icon={<Trophy size={20} />}>
                Leaderboard
              </NavLink>
              {user?.isAdmin ? (
                <AdminMenu />
              ) : (
                <NavLink to="/challenges" icon={<Flag size={20} />}>
                  Challenges
                </NavLink>
              )}
            </div>
          </div>

          {/* Mobile menu button */}
          <button
            className="text-muted-foreground hover:text-foreground text-muted-foreground dark:hover:text-foreground md:hidden"
            onClick={toggleMenu}
          >
            {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>

          {/* Right-side navigation items (visible on md and above) */}
          <div className="hidden items-center space-x-4 md:flex">
            <UserMenu user={user!} logout={logout} />
          </div>
        </div>

        {/* Mobile navigation */}
        {isMenuOpen && (
          <div className="mt-4 space-y-4 md:hidden">
            <NavLink to="/teams" icon={<Users size={20} />}>
              Teams
            </NavLink>
            <NavLink to="/leaderboard" icon={<Trophy size={20} />}>
              Leaderboard
            </NavLink>
            {user?.isAdmin ? (
              <AdminMenu />
            ) : (
              <NavLink to="/challenges" icon={<Flag size={20} />}>
                Challenges
              </NavLink>
            )}
            <UserMenu user={user!} logout={logout} />
          </div>
        )}
      </div>
    </nav>
  );
};

const AdminMenu = () => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button
        variant="outline"
        className="flex items-center space-x-2 text-muted-foreground"
      >
        <Menu size={20} />
        <span>Admin Settings</span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent>
      <DropdownMenuItem>
        <Link to="/admin/dashboard" className="flex items-center space-x-2">
          <Settings size={16} />
          <span>Admin Dashboard</span>
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem><Link to="/admin/event" className="flex items-center space-x-2"><Settings size={16} /><span>Event settings</span></Link></DropdownMenuItem>
      <DropdownMenuItem><Link to="/admin/users" className="flex items-center space-x-2"><Users size={16} /><span>Participants</span></Link></DropdownMenuItem>
      <DropdownMenuItem><Link to="/admin/teams" className="flex items-center space-x-2"><Users size={16} /><span>Teams</span></Link></DropdownMenuItem>
      <DropdownMenuItem><Link to="/admin/content" className="flex items-center space-x-2"><Flag size={16} /><span>Announcements and pages</span></Link></DropdownMenuItem>
      <DropdownMenuItem>
        <Link to="/challenges" className="flex items-center space-x-2">
          <Flag size={16} />
          <span>Manage Challenges</span>
        </Link>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);

const UserMenu = ({ user, logout }: { user: User; logout: () => void }) =>
  user ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="flex items-center space-x-2 text-muted-foreground"
        >
          <UserIcon size={20} />
          <span>Account</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>
          <Link to="/profile" className="flex items-center space-x-2">
            <UserIcon size={16} />
            <span>Profile</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={logout}>
          <span className="flex items-center space-x-2">
            <LogOut size={16} />
            <span>Logout</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : (
    <div className="flex items-center space-x-2">
      <Link to="/register">
        <Button
          variant="outline"
          className="flex items-center space-x-2 text-muted-foreground"
        >
          <UserRoundPlus size={20} />
          <span>Register</span>
        </Button>
      </Link>
      <Link to="/login">
        <Button
          variant="outline"
          className="flex items-center space-x-2 text-muted-foreground"
        >
          <LogIn size={20} />
          <span>Login</span>
        </Button>
      </Link>
    </div>
  );


