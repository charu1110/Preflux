import Link from "next/link";
import LoginForm from "./LoginForm";

export const metadata = { title: "Sign in · Preflux" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <Link href="/" className="text-lg font-bold tracking-tight">
          <span className="text-violet-600">pre</span>flux
        </Link>
        <h1 className="mt-6 text-2xl font-bold tracking-tight">Team dashboard</h1>
        <p className="mt-1 mb-6 text-sm text-zinc-600 dark:text-zinc-400">See every push, its Push Safety Score, risky files and team collisions.</p>
        <LoginForm next={next ?? "/dashboard"} />
      </div>
    </main>
  );
}
