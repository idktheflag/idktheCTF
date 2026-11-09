import { useAuth } from "@/auth-context";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import React, { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Input } from "../components/ui/input";

export const Register: React.FC = () => {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { register } = useAuth();
  const [params] = useSearchParams();
  const invitationToken = params.get("invite") || undefined;
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [registrationSubmitted, setRegistrationSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await register(username, email, password, invitationToken);
      setRegistrationSubmitted(true);
    } catch (error) {
      console.error("Registration failed:", error);
      setError("Registration failed." + error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="mx-auto mt-8 w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-2xl font-bold text-foreground text-foreground">
          Register
        </CardTitle>
          <CardDescription className="text-muted-foreground dark:text-muted-foreground">
          {invitationToken ? "Complete your invited participant registration" : "Create a new account to join the platform"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {registrationSubmitted ? (
          <div className="space-y-4 text-center" role="status">
            <p className="text-sm text-muted-foreground">
              If registration was completed, sign in and follow the email verification steps. If you already have an account, sign in or reset your password.
            </p>
            <Button asChild className="w-full">
              <Link to="/login">Continue to sign in</Link>
            </Button>
          </div>
        ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="name"
              className="text-sm font-medium text-muted-foreground text-muted-foreground"
            >
              Username <span className="font-normal">(participants)</span>
            </label>
            <Input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username"
              className="w-full"
              disabled={loading}
            />
            <p className="text-xs text-muted-foreground">Organizers can leave this blank and sign in with email and password.</p>
          </div>
          <div className="space-y-2">
            <label
              htmlFor="email"
              className="text-sm font-medium text-muted-foreground text-muted-foreground"
            >
              Email
            </label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              required
              className="w-full"
              disabled={loading}
            />
          </div>
          <div className="space-y-2">
            <label
              htmlFor="password"
              className="text-sm font-medium text-muted-foreground text-muted-foreground"
            >
              Password
            </label>
            <Input
              id="password"
              type="password"
              minLength={12}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Create a password"
              required
              className="w-full"
              disabled={loading}
            />
          </div>
          {error && (
            <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
          )}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Registering...
              </>
            ) : (
              "Register"
            )}
          </Button>
        </form>
        )}
      </CardContent>
      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground dark:text-muted-foreground">
          Already have an account?{" "}
          <Link
            to="/login"
            className="text-primary hover:underline dark:text-primary"
          >
            Login here
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
};

