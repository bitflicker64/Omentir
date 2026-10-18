import { beforeEach, expect, mock, test } from "bun:test";
import type { Campaign, CampaignEnrollment, Lead } from "./types";

mock.module("server-only", () => ({}));

const reads: string[] = [];
const lead = (id: string, sourceAgentId: string) =>
  ({ id, workspaceId: "ws", name: id, title: "", company: "", location: "", fitScore: 50, sourceAgentId, outreachStatus: "new" }) as unknown as Lead;
const leads = [lead("mine", "agent-1"), lead("theirs", "agent-2")];
const enrollment = (leadId: string) =>
  ({ id: `e-${leadId}`, workspaceId: "ws", campaignId: "c1", leadId, status: "queued", currentStepIndex: 0, nextActionAt: "2026-10-18T10:00:00.000Z" }) as CampaignEnrollment;
const enrollments = leads.map((item) => enrollment(item.id));
const campaign = {
  id: "c1", workspaceId: "ws", name: "Campaign", groupId: "g1", status: "active",
  steps: [{ id: "s1", type: "connect", includeNote: false, noteTemplate: "" }],
} as Campaign;

mock.module("./data", () => ({
  listCampaigns: async () => [campaign],
  listAgents: async () => [],
  listGroups: async () => [],
  isSourcedByLeadsOnlyAgent: () => false,
  getOutreachConversationFactsByLeadIds: async () => new Map(),
  listLeadEnrollments: async () => [],
  listAgentLeads: async (_workspaceId: string, agentId: string) => {
    reads.push("agent leads");
    return leads.filter((item) => item.sourceAgentId === agentId);
  },
  listEnrollmentsForLeads: async (_workspaceId: string, leadIds: string[]) => {
    reads.push(`enrollments of ${leadIds.join(",")}`);
    return enrollments.filter((item) => leadIds.includes(item.leadId));
  },
  listCampaignEnrollments: async () => {
    reads.push("every enrollment");
    return enrollments;
  },
  getLeadsByIds: async (_workspaceId: string, ids: string[]) => {
    reads.push("leads by id");
    return leads.filter((item) => ids.includes(item.id));
  },
  getCampaign: async () => null,
  getCampaignEnrollment: async () => null,
  updateEnrollment: async () => undefined,
}));

const { listScheduledActions } = await import("./scheduled-actions");

beforeEach(() => {
  reads.length = 0;
});

// /agents/[id] took 26s on a workspace with 6k enrollments because it read
// every enrollment and every enrolled lead, then kept the agent's 3. It must
// start from the agent's own leads instead.
test("an agent's queue reads only that agent's leads and their enrollments", async () => {
  const actions = await listScheduledActions("ws", { agentId: "agent-1" });

  expect(actions.map((action) => action.lead?.id)).toEqual(["mine"]);
  expect(reads).toEqual(["agent leads", "enrollments of mine"]);
});

test("the workspace queue still covers every agent's leads", async () => {
  const actions = await listScheduledActions("ws");

  expect(actions.map((action) => action.lead?.id).sort()).toEqual(["mine", "theirs"]);
  expect(reads).toContain("every enrollment");
});
