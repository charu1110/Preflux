import Link from "next/link";
import { createUserClient } from "@/lib/supabase/server";
import { signOut } from "../login/actions";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createUserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <Link href="/dashboard" className="text-lg font-bold tracking-tight">
            <span className="text-violet-600">pre</span>flux <span className="text-sm font-normal text-zinc-500">dashboard</span>
          </Link>
          <div className="flex items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
            <span className="hidden sm:inline">{user?.email}</span>
            <form action={signOut}>
              <button className="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">Sign out</button>
            </form>
          </div>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
