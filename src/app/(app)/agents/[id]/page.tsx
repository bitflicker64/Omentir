import { auth } from "@/lib/server/auth";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { createPageMetadata } from "@/app/seo";
import { getAgent } from "@/lib/server/data";
import { resolveActiveWorkspace } from "@/lib/server/active-workspace";
import { listScheduledActions } from "@/lib/server/scheduled-actions";
import { formatZonedDate } from "@/lib/time-zone";
import { AgentActionsSkeleton } from "@/app/app-skeletons";
import ActivityDashboard from "../../actions/activity-dashboard";
import { AgentStatusPill } from "../agent-status-pill";

export const metadata = createPageMetadata({
  title: "Agent Actions - Omentir",
  description: "Review every upcoming action for an Omentir agent.",
  path: "/agents",
  noIndex: true,
});

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AgentActionsPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const { userId } = await auth();
  if (!userId) {
    await auth.protect();
    throw new Error("Unauthorized");
  }

  const workspace = await resolveActiveWorkspace(userId);
  const agent = await getAgent(workspace.id, id);
  if (!agent) return notFound();

  const searching = agent.status === "active" || agent.status === "running";
  const details = [
    `Lead group: ${agent.targetGroupName}`,
    agent.leadsOnly ? "Finds leads only" : "",
    searching && agent.mode !== "outreach" && agent.nextRunAt
      ? `Next lead search ${formatZonedDate(agent.nextRunAt, workspace.timezone, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
      : "",
  ].filter(Boolean);

  // The header needs only the agent doc, so it paints right away; the queue
  // streams in behind its own skeleton.
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-hidden md:mr-0.5 md:pb-3">
      {/* Same header as the other app pages, with the agent card's
          View/Edit button pair on the right. */}
      <header className="app-x flex shrink-0 items-start justify-between gap-3 pt-5 md:pt-6">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <h1 className="min-w-0 break-words text-2xl font-semibold leading-none tracking-tight text-[var(--md-sys-color-on-surface)]">
              {agent.name || agent.targetGroupName || "Agent"}
            </h1>
            <AgentStatusPill status={agent.status} />
          </div>
          <p className="mt-2 text-sm text-[var(--md-sys-color-on-surface-variant)]">{details.join(" · ")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link href="/agents" className="m3-btn m3-btn-outlined h-8 px-2.5 text-xs">
            Back
          </Link>
          <Link href={`/agents/new?id=${agent.id}`} className="m3-btn m3-btn-filled h-8 px-2.5 text-xs">
            Edit
          </Link>
        </div>
      </header>
      <Suspense fallback={<AgentActionsSkeleton />}>
        <AgentQueue workspaceId={workspace.id} agentId={agent.id} timezone={workspace.timezone} />
      </Suspense>
    </div>
  );
}

async function AgentQueue({ workspaceId, agentId, timezone }: { workspaceId: string; agentId: string; timezone?: string }) {
  const items = await listScheduledActions(workspaceId, { agentId });
  const serverNow = new Date().getTime();
  return <ActivityDashboard items={items} serverNow={serverNow} timezone={timezone} />;
}
