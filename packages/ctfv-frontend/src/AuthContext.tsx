import { apiFetch } from "@/lib/api";
import { jwtDecode } from "jwt-decode";
import React, { useEffect, useState } from "react";

import { AuthContext } from "./auth-context";
import { getBackendURL } from "./lib/utils";

export interface User {
  userId: string;
  email: string;
  username?: string;
  isAdmin: boolean;
  emailVerified: boolean;
  exp: number;
}

export interface Challenge {
  id: string;
  name: string;
  description: string;
  url: string;
  points: number;
  category: string;
  author: string;
  date?: string;
  flag?: string | null; // The flag is only visible to admins
  maxAttempts?: number | null;
  tags?: string[];
  flags?: { value: string; type: "static" | "regex" }[];
  hints?: { id?: string | null; body: string; cost: number }[];
  isVisible?: boolean;
}

function readStoredUser(): User | null {
  const token = localStorage.getItem("token");
  if (!token) return null;
  try {
    const user = jwtDecode<User>(token);
    if (Number.isFinite(user.exp) && user.exp * 1000 > Date.now()) return user;
  } catch { /* Invalid saved credentials must return to sign-in. */ }
  localStorage.removeItem("token");
  sessionStorage.setItem("auth-notice", "Your session expired. Sign in again.");
  return null;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null>(readStoredUser);

  useEffect(() => {
    const expired = () => {
      sessionStorage.setItem("auth-notice", "Your session expired or was revoked. Sign in again.");
      localStorage.removeItem("token");
      setUser(null);
    };
    window.addEventListener("ctf:session-expired", expired);
    const synchronize = (event: StorageEvent) => {
      if (event.key === "token") setUser(readStoredUser());
    };
    window.addEventListener("storage", synchronize);
    return () => {
      window.removeEventListener("ctf:session-expired", expired);
      window.removeEventListener("storage", synchronize);
    };
  }, []);



  useEffect(() => {
    if (!user) return;
    const timeout = window.setTimeout(() => {
      sessionStorage.setItem("auth-notice", "Your session expired. Sign in again.");
      localStorage.removeItem("token");
      setUser(null);
    }, Math.max(0, Math.min(user.exp * 1000 - Date.now(), 2147483647)));
    return () => window.clearTimeout(timeout);
  }, [user]);

  const updateUserFromToken = (token: string): User => {
    sessionStorage.removeItem("auth-notice");
    localStorage.setItem("token", token);
    const decodedToken = jwtDecode<User>(token);
    setUser(decodedToken);
    return decodedToken;
  };

  const login = async (email: string, password: string): Promise<User> => {
    const response = await apiFetch(getBackendURL() + "/api/users/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await response.json();
    if (response.ok) {
      return updateUserFromToken(data.token);
    } else {
      throw new Error(data.error);
    }
  };

  const register = async (
    username: string,
    email: string,
    password: string,
    invitationToken?: string,
  ) => {
    const response = await apiFetch(getBackendURL() + "/api/users/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, email, password, isAdmin: false, invitationToken }),
    });
    const data = await response.json();
    if (response.ok) {
      updateUserFromToken(data.token);
    } else {
      throw new Error(data.error);
    }
  };

  const logout = () => {
    sessionStorage.removeItem("auth-notice");
    localStorage.removeItem("token");
    setUser(null);
  };

  const verifyEmail = async (token: string) => {
    const response = await apiFetch(
      getBackendURL() + `/api/users/auth/verify-email?token=${token}`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      },
    );
    const data = await response.json();
    if (response.ok) {
      updateUserFromToken(data.token);
    } else {
      throw new Error(data.error);
    }
  };

  const requestPasswordReset = async (email: string) => {
    const response = await apiFetch(getBackendURL() + "/api/users/auth/password-reset/request", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not request a password reset");
    return data.message as string;
  };

  const completePasswordReset = async (token: string, password: string) => {
    const response = await apiFetch(getBackendURL() + "/api/users/auth/password-reset/complete", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not reset password");
    return data.message as string;
  };

  // Challenge Management Functions

  const createChallenge = async (challengeData: Omit<Challenge, "id">) => {
    const token = localStorage.getItem("token");
    const response = await apiFetch(getBackendURL() + "/api/challenges/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(challengeData),
    });

    const data = await response.json();
    if (!response.ok) {
      const errorData = data;
      throw new Error(errorData.error || "Failed to create the challenge");
    }
    return data as Challenge;
  };

  const getChallenges = async (): Promise<
    {
      category: string;
      challenges: Challenge[];
    }[]
  > => {
    const token = localStorage.getItem("token");
    const response = await apiFetch(getBackendURL() + "/api/challenges/read", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to fetch challenges");
    }
    return data.challenges;
  };

  const updateChallenge = async (
    id: string,
    challengeData: Partial<Challenge>,
  ) => {
    const token = localStorage.getItem("token");
    const response = await apiFetch(
      getBackendURL() + `/api/challenges/update/${id}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(challengeData),
      },
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || "Failed to update the challenge");
    }
  };

  const deleteChallenge = async (id: string) => {
    const token = localStorage.getItem("token");
    const response = await apiFetch(
      getBackendURL() + `/api/challenges/delete/${id}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || "Failed to delete the challenge");
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        login,
        register,
        logout,
        createChallenge,
        getChallenges,
        updateChallenge,
        deleteChallenge,
        verifyEmail,
        requestPasswordReset,
        completePasswordReset,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

