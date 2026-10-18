import type { Agent } from "@/lib/server/types";

// No "use client": the agents list renders it on the client, the agent page
// renders it on the server.
export function AgentStatusPill({ status }: { status: Agent["status"] }) {
  if (status === "active" || status === "running") {
    return (
      <span className="inline-flex h-5 items-center gap-1 rounded-md bg-emerald-50 px-2.5 text-[11px] font-medium leading-none text-emerald-700">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Active
      </span>
    );
  }
  if (status === "paused") {
    return (
      <span className="inline-flex h-5 items-center rounded-md bg-zinc-100 px-2.5 text-[11px] font-semibold leading-none text-zinc-700">
        Paused
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex h-5 items-center gap-1 rounded-md bg-red-50 px-2.5 text-[11px] font-medium leading-none text-red-700">
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" /> Error
      </span>
    );
  }
  return (
    <span className="inline-flex h-5 items-center rounded-md bg-zinc-100 px-2.5 text-[11px] font-medium leading-none text-zinc-600">
      Draft
    </span>
  );
}
