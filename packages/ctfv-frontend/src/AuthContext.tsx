import { jwtDecode } from "jwt-decode";
import React, { createContext, useContext, useEffect, useState } from "react";

import { getBackendURL } from "./lib/utils";

export interface User {
  userId: string;
  email: string;
  username?: string;
  isAdmin: boolean;
  emailVerified: boolean;
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
  hints?: { body: string; cost: number }[];
  isVisible?: boolean;
}

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<User>;
  register: (name: string, email: string, password: string, invitationToken?: string) => Promise<void>;
  logout: () => void;
  createChallenge: (challengeData: Omit<Challenge, "id">) => Promise<Challenge>;
  getChallenges: () => Promise<{ category: string; challenges: Challenge[] }[]>;
  updateChallenge: (
    id: string,
    challengeData: Partial<Challenge>,
  ) => Promise<void>;
  deleteChallenge: (id: string) => Promise<void>;
  verifyEmail: (token: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<string>;
  completePasswordReset: (token: string, password: string) => Promise<string>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      try {
        const decodedToken = jwtDecode<User>(token);
        setUser(decodedToken);
      } catch (error) {
        console.error("Invalid token:", error);
        localStorage.removeItem("token");
      }
    }
  }, []);

  const updateUserFromToken = (token: string): User => {
    localStorage.setItem("token", token);
    const decodedToken = jwtDecode<User>(token);
    setUser(decodedToken);
    return decodedToken;
  };

  const login = async (email: string, password: string): Promise<User> => {
    const response = await fetch(getBackendURL() + "/api/users/auth/login", {
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
    const response = await fetch(getBackendURL() + "/api/users/auth/register", {
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
    localStorage.removeItem("token");
    setUser(null);
  };

  const verifyEmail = async (token: string) => {
    const response = await fetch(
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
    const response = await fetch(getBackendURL() + "/api/users/auth/password-reset/request", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not request a password reset");
    return data.message as string;
  };

  const completePasswordReset = async (token: string, password: string) => {
    const response = await fetch(getBackendURL() + "/api/users/auth/password-reset/complete", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not reset password");
    return data.message as string;
  };

  // Challenge Management Functions

  const createChallenge = async (challengeData: Omit<Challenge, "id">) => {
    const token = localStorage.getItem("token");
    const response = await fetch(getBackendURL() + "/api/challenges/create", {
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
    const response = await fetch(getBackendURL() + "/api/challenges/read", {
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
    const response = await fetch(
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
    const response = await fetch(
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

