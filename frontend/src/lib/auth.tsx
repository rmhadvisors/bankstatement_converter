import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const saved = window.localStorage.getItem("statement-savior-session");
    if (saved) {
      try {
        const user = JSON.parse(saved) as User;
        if (!user.user_metadata) (user as any).user_metadata = {};
        if (!(user as any).user_metadata.full_name || (user as any).user_metadata.full_name === "Local user") {
          (user as any).user_metadata.full_name = "rmhadvisors";
        }
        setSession({ user } as Session);
      } catch {
        setSession(null);
      }
      setLoading(false);
      return () => {
        active = false;
      };
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (!active) return;
      setSession(s);
      setLoading(false);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const setLocalSession = async (user: User | null) => {
    if (user) {
      if (!(user as any).user_metadata) (user as any).user_metadata = {};
      if (!(user as any).user_metadata.full_name || (user as any).user_metadata.full_name === "Local user") {
        (user as any).user_metadata.full_name = "rmhadvisors";
      }
      window.localStorage.setItem("statement-savior-session", JSON.stringify(user));
      setSession({ user } as Session);
    } else {
      window.localStorage.removeItem("statement-savior-session");
      setSession(null);
    }
  };

  return (
    <Ctx.Provider
      value={{
        user: session?.user ?? null,
        session,
        loading,
        signIn: async (user: User) => {
          await setLocalSession(user);
        },
        signUp: async (user: User) => {
          await setLocalSession(user);
        },
        signOut: async () => {
          window.localStorage.removeItem("statement-savior-session");
          await supabase.auth.signOut();
          setSession(null);
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
