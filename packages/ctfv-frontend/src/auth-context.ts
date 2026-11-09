import { createContext, useContext } from "react";
import type { User, Challenge } from "./AuthContext";

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

export const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
