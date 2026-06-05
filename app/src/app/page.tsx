"use client";

import { db } from "@/lib/db";
import { Login } from "@/components/Login";
import { AppShell } from "@/components/AppShell";

export default function Home() {
  const { isLoading, user, error } = db.useAuth();

  if (isLoading) {
    return null;
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-destructive">
          Auth error: {error.message}
        </p>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return <AppShell user={user} />;
}
