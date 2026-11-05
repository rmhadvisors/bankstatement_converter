import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// Local session only, kept in this browser; there is no account backend.
type User = { id: string; email?: string; user_metadata?: Record<string, unknown> };
type Session = { user: User };

type AuthCtx = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (user: User) => Promise<void>;
  signUp: (user: User) => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({
  user: null,
  session: null,
  loading: true,
  signIn: async () => {},
  signUp: async () => {},
  signOut: async () => {},
});

const SESSION_KEY = "statement-savior-session";

function withName(user: User): User {
  const meta = user.user_metadata ?? {};
  if (!meta.full_name || meta.full_name === "Local user") meta.full_name = "rmhadvisors";
  user.user_metadata = meta;
  return user;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const saved = window.localStorage.getItem(SESSION_KEY);
    if (saved) {
      try {
        setSession({ user: withName(JSON.parse(saved) as User) });
      } catch {
        setSession(null);
      }
    }
    setLoading(false);
  }, []);

  const setLocalSession = async (user: User | null) => {
    if (user) {
      withName(user);
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(user));
      setSession({ user });
    } else {
      window.localStorage.removeItem(SESSION_KEY);
      setSession(null);
    }
  };

  return (
    <Ctx.Provider
      value={{
        user: session?.user ?? null,
        session,
        loading,
        signIn: setLocalSession,
        signUp: setLocalSession,
        signOut: () => setLocalSession(null),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
