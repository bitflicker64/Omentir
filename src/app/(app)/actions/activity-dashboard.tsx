"use client";

import { unwrapAction } from "@/lib/action-result";
import { userFacingError } from "@/app/toast";
import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runScheduledActionNowAction, stopLeadOutreachAction } from "@/app/actions";
import type { ScheduledAction } from "@/lib/server/scheduled-actions";
import { useWorkspaceTimeZone } from "@/app/workspace-time-zone";
import { formatZonedTime, zonedDayKey } from "@/lib/time-zone";
import { ActionDetails, dateLabel, resultMessage, timeLabel } from "./action-details";
import { LeadAvatar } from "@/app/lead-avatar";

type Lead = NonNullable<ScheduledAction["lead"]>;
type LeadActions = { lead: Lead; actions: ScheduledAction[] };

const PER_PAGE_OPTIONS = [10, 50, 100];
const VIEW_MODES = [
  { id: "time" as const, label: "By time" },
  { id: "lead" as const, label: "By leads" },
];
const ALL_GROUPS = "all";
const DAY_MS = 86_400_000;
const WAITING_HEADING = "Waiting on acceptance";

function Avatar({ lead }: { lead: Lead }) {
  return (
    <LeadAvatar
      name={lead.name}
      avatarUrl={lead.avatarUrl}
      leadId={lead.id}
      className="h-9 w-9 bg-[#f8e8ef]"
      initialsClassName="text-[11px] font-bold text-[#ba3871]"
    />
  );
}

// The heading a lead's next action sits under in the By time view. Waiting
// rows have no real send time (`at` is only the give-up date), so they get
// their own group at the end instead of a misleading day.
function timeHeading(action: ScheduledAction, now: number, timeZone: string) {
  if (action.awaitingConnection) return WAITING_HEADING;
  const at = new Date(action.at).getTime();
  if (at <= now) return "Due now";
  const day = zonedDayKey(at, timeZone);
  if (day === zonedDayKey(now, timeZone)) return "Today";
  if (day === zonedDayKey(now + DAY_MS, timeZone)) return "Tomorrow";
  return dateLabel(at, timeZone);
}

export default function ActionsDashboard({ items, serverNow, timezone }: { items: ScheduledAction[]; serverNow: number; timezone?: string }) {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const workspaceTimeZone = useWorkspaceTimeZone();
  const timeZone = timezone || workspaceTimeZone;
  // Empty until a row is clicked: the first visible row is selected instead.
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);
  const [confirmingId, setConfirmingId] = useState("");
  const [confirmingStopLeadId, setConfirmingStopLeadId] = useState("");
  const [pendingId, setPendingId] = useState("");
  const [feedback, setFeedback] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [viewMode, setViewMode] = useState<"time" | "lead">("time");
  const [groupId, setGroupId] = useState(ALL_GROUPS);
  const [perPage, setPerPage] = useState(10);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible" && !isRefreshing) {
        startRefresh(() => router.refresh());
      }
    };
    const interval = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [isRefreshing, router]);

  // Lead groups the scheduled actions actually belong to, so the filter never
  // offers a group with nothing in it.
  const leadGroups = useMemo(() => {
    const named = new Map<string, string>();
    for (const action of items) {
      if (action.groupId && action.group) named.set(action.groupId, action.group);
    }
    return Array.from(named, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  const leads = useMemo(() => {
    const groups = new Map<string, LeadActions>();
    for (const action of items) {
      if (!action.lead) continue;
      if (groupId !== ALL_GROUPS && action.groupId !== groupId) continue;
      const group = groups.get(action.lead.id) || { lead: action.lead, actions: [] };
      group.actions.push(action);
      groups.set(action.lead.id, group);
    }
    return Array.from(groups.values()).map((group) => ({ ...group, actions: group.actions.sort((a, b) => a.at.localeCompare(b.at)) })).sort((a, b) => a.actions[0].at.localeCompare(b.actions[0].at));
  }, [items, groupId]);

  // Counted from each lead's next action, the same one its row shows.
  const summary = useMemo(() => {
    let due = 0;
    let waiting = 0;
    let replies = 0;
    for (const { actions: [next] } of leads) {
      if (next.isReply) replies += 1;
      if (next.awaitingConnection) waiting += 1;
      else if (new Date(next.at).getTime() <= serverNow) due += 1;
    }
    return [
      { label: "Scheduled", value: leads.length },
      { label: "Due now", value: due },
      { label: WAITING_HEADING, value: waiting },
      { label: "Replies to send", value: replies },
    ];
  }, [leads, serverNow]);

  // By leads: the best-fit people first, so the highest-value leads are the
  // ones you inspect. By time: whatever fires soonest, with the rows still
  // waiting on a connection last (sort is stable, so time order holds).
  const visibleLeads = viewMode === "lead"
    ? [...leads].sort((a, b) =>
        (b.lead.fitScore || 0) - (a.lead.fitScore || 0) ||
        a.actions[0].at.localeCompare(b.actions[0].at) ||
        a.lead.name.localeCompare(b.lead.name),
      )
    : [...leads].sort((a, b) => Number(a.actions[0].awaitingConnection) - Number(b.actions[0].awaitingConnection));
  const selectedLead = leads.find((group) => group.lead.id === selectedLeadId) || visibleLeads[0];
  const selected = selectedLead?.actions.find((action) => action.id === selectedId) || selectedLead?.actions[0];
  const total = leads.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * perPage;
  const end = Math.min(start + perPage, total);
  const pageRows = visibleLeads.slice(start, end);
  const headings = viewMode === "time" ? pageRows.map((group) => timeHeading(group.actions[0], serverNow, timeZone)) : [];

  function selectAction(action: ScheduledAction) {
    setSelectedLeadId(action.lead?.id || "");
    setSelectedId(action.id);
    setConfirmingId("");
    setConfirmingStopLeadId("");
    setMobileDetailsOpen(true);
  }

  function changeViewMode(mode: "time" | "lead") {
    setViewMode(mode);
    setPage(1);
    setConfirmingId("");
    setConfirmingStopLeadId("");
  }

  function changeGroup(nextGroupId: string) {
    setGroupId(nextGroupId);
    setPage(1);
    setConfirmingId("");
    setConfirmingStopLeadId("");
  }

  async function runNow(action: ScheduledAction) {
    setPendingId(action.id);
    setFeedback((current) => { const next = { ...current }; delete next[action.id]; return next; });
    const formData = new FormData();
    formData.set("enrollmentId", action.id);
    try {
      const { result } = unwrapAction(await runScheduledActionNowAction(formData));
      setFeedback((current) => ({ ...current, [action.id]: resultMessage(result, action.kind) }));
      setConfirmingId("");
      router.refresh();
    } catch (error) {
      setFeedback((current) => ({ ...current, [action.id]: { ok: false, text: userFacingError(error, "The action could not be sent.") } }));
    } finally {
      setPendingId("");
    }
  }

  async function stopOutreach(action: ScheduledAction) {
    const leadId = action.lead?.id;
    if (!leadId) return;
    setPendingId(action.id);
    setFeedback((current) => { const next = { ...current }; delete next[action.id]; return next; });
    const formData = new FormData();
    formData.set("leadId", leadId);
    try {
      unwrapAction(await stopLeadOutreachAction(formData));
      setConfirmingStopLeadId("");
      setMobileDetailsOpen(false);
      router.refresh();
    } catch (error) {
      setFeedback((current) => ({ ...current, [action.id]: { ok: false, text: userFacingError(error, "Outreach could not be stopped.") } }));
    } finally {
      setPendingId("");
    }
  }

  const groupPicker = leadGroups.length > 1 ? (
    <label className="flex h-8 items-center gap-2 rounded-md border border-zinc-200 bg-white px-2.5 text-xs font-semibold text-zinc-700">
      {/* Inline SVG, like the view picker beside it: "group" is not in the
          self-hosted icon subset, and font-display: block would paint the raw
          ligature text instead of a glyph. */}
      <svg className="h-3.5 w-3.5 shrink-0 text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
      <span className="relative">
        <select
          aria-label="Filter by lead group"
          value={groupId}
          onChange={(event) => changeGroup(event.target.value)}
          className="max-w-[9.5rem] cursor-pointer appearance-none truncate border-0 bg-transparent pr-6 shadow-none outline-none"
        >
          <option value={ALL_GROUPS}>All lead groups</option>
          {leadGroups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
        <span className="material-symbols-outlined pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-[16px] text-zinc-500" aria-hidden="true">
          arrow_drop_down
        </span>
      </span>
    </label>
  ) : null;

  return (
    // A div, not <main>: the app layout already has the page's <main>, and the
    // `html.dark main` rule painted this one in the canvas tone as a
    // square-cornered block inside the rounded panel.
    <div className="app-x flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      {/* Stat cards as on Overview. */}
      <section aria-label="Outreach queue" className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
        {summary.map((stat) => (
          <div key={stat.label} className="m3-card m3-card-outlined p-4">
            <p className="truncate text-[12px] text-[var(--md-sys-color-on-surface-variant)]">{stat.label}</p>
            <p className="stat-value mt-2 text-[var(--md-sys-color-on-surface)]">{stat.value}</p>
          </div>
        ))}
      </section>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <h2 className="section-title text-[var(--md-sys-color-on-surface)]">Next actions</h2>
        <div className="flex flex-wrap items-center gap-2">
          {groupPicker}
          <div className="app-seg" role="group" aria-label="Group actions">
            {VIEW_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                aria-pressed={viewMode === mode.id}
                onClick={() => changeViewMode(mode.id)}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!leads.length ? (
        <div className="m3-card m3-card-outlined m3-card-lg border-dashed py-16 text-center">
          <span className="material-symbols-outlined text-3xl text-zinc-400">event_available</span>
          <h2 className="mt-3 text-sm font-semibold text-zinc-900">Nothing scheduled</h2>
          <p className="mt-1 text-xs text-zinc-500">
            {groupId === ALL_GROUPS
              ? "Leads from active campaigns will appear here."
              : "No scheduled actions in this lead group yet."}
          </p>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-rows-1 gap-4 overflow-hidden md:grid-rows-2 lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-1">
          <div className="m3-card m3-card-elevated m3-card-lg flex min-h-0 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-zinc-100">
              {pageRows.map((group, index) => {
                const action = group.actions[0];
                const active = selectedLead?.lead.id === group.lead.id;
                const heading = headings[index];
                const timed = !action.awaitingConnection;
                return (
                  <Fragment key={group.lead.id}>
                    {heading && heading !== headings[index - 1] ? (
                      <h3 className="px-4 pb-2 pt-4 text-[12px] font-medium text-[var(--md-sys-color-on-surface-variant)]">
                        {heading}
                      </h3>
                    ) : null}
                    {/* Selected tint is the Leads table's open row. */}
                    <button
                      type="button"
                      onClick={() => selectAction(action)}
                      aria-current={active ? "true" : undefined}
                      className={`flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-zinc-50 ${active ? "bg-[#fff7fa]" : "bg-white"}`}
                    >
                      <Avatar lead={group.lead} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-semibold text-zinc-950">{group.lead.name}</p>
                          {viewMode === "lead" ? (
                            <span className="shrink-0 text-[11px] font-bold tabular-nums text-zinc-500" aria-label={`Fit score ${group.lead.fitScore || 0}`}>
                              {group.lead.fitScore || 0}
                            </span>
                          ) : null}
                          {viewMode === "lead" && timed && new Date(action.at).getTime() <= serverNow ? (
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Due now</span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-zinc-500">
                          {[group.lead.title, group.lead.company].filter(Boolean).join(" · ")}
                        </p>
                        <p className="mt-1.5 truncate text-xs font-medium text-zinc-700">
                          {action.title} <span className="font-normal text-zinc-400">· {action.campaign}</span>
                        </p>
                      </div>
                      {viewMode === "time" ? (
                        timed ? <p className="shrink-0 text-xs font-semibold tabular-nums text-zinc-800">{formatZonedTime(action.at, timeZone)}</p> : null
                      ) : (
                        <div className="shrink-0 text-right">
                          {timed ? (
                            <>
                              <p className="text-xs font-semibold text-zinc-800">{dateLabel(action.at, timeZone)}</p>
                              <p className="mt-1 text-[11px] text-zinc-400">{timeLabel(action.at, timeZone)}</p>
                            </>
                          ) : (
                            <>
                              <p className="text-xs font-semibold text-amber-700">Awaiting</p>
                              <p className="mt-1 text-[11px] text-zinc-400">connection</p>
                            </>
                          )}
                        </div>
                      )}
                      <span className="material-symbols-outlined text-[18px] text-zinc-300">chevron_right</span>
                    </button>
                  </Fragment>
                );
              })}
            </div>

            <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-t border-[var(--md-sys-color-outline-variant)] px-3 text-[11px]">
              <span className="min-w-0 truncate font-medium text-[var(--md-sys-color-on-surface-variant)]">
                {`${start + 1}–${end} of ${total}`}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                <label className="flex items-center gap-1.5 font-medium text-[var(--md-sys-color-on-surface-variant)]">
                  <span className="hidden sm:inline">Rows</span>
                  <select
                    value={String(perPage)}
                    onChange={(event) => {
                      setPerPage(Number(event.target.value));
                      setPage(1);
                    }}
                    className="h-7 cursor-pointer rounded-md border border-[var(--md-sys-color-outline)] bg-[var(--md-sys-color-surface-container)] px-1.5 text-[11px] font-semibold text-[var(--md-sys-color-on-surface)] outline-none focus:border-[var(--md-sys-color-primary)]"
                    aria-label="Rows per page"
                  >
                    {PER_PAGE_OPTIONS.map((option) => (
                      <option key={option} value={String(option)}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={currentPage === 1}
                    className="grid h-7 w-7 cursor-pointer place-items-center rounded-md border border-[var(--md-sys-color-outline)] bg-[var(--md-sys-color-surface-container)] text-[var(--md-sys-color-on-surface-variant)] transition-colors hover:bg-[var(--md-sys-state-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Previous page"
                  >
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                  </button>
                  <span className="grid h-7 min-w-7 place-items-center rounded-md bg-[var(--md-sys-color-primary-container)] px-1.5 text-[11px] font-bold text-[var(--md-sys-color-on-primary-container)]">
                    {currentPage}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                    disabled={currentPage === totalPages}
                    className="grid h-7 w-7 cursor-pointer place-items-center rounded-md border border-[var(--md-sys-color-outline)] bg-[var(--md-sys-color-surface-container)] text-[var(--md-sys-color-on-surface-variant)] transition-colors hover:bg-[var(--md-sys-state-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Next page"
                  >
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="hidden min-h-0 md:block">
            {selected ? (
              <ActionDetails
                action={selected}
                siblings={selectedLead?.actions || []}
                onSelectSibling={selectAction}
                timeZone={timeZone}
                pending={pendingId === selected.id}
                confirming={confirmingId === selected.id}
                confirmingStop={confirmingStopLeadId === selected.lead?.id}
                feedback={feedback[selected.id]}
                onConfirm={() => {
                  setConfirmingStopLeadId("");
                  setConfirmingId(selected.id);
                }}
                onCancel={() => setConfirmingId("")}
                onRun={() => runNow(selected)}
                onConfirmStop={() => {
                  setConfirmingId("");
                  setConfirmingStopLeadId(selected.lead?.id || "");
                }}
                onCancelStop={() => setConfirmingStopLeadId("")}
                onStop={() => stopOutreach(selected)}
                showTimeline
              />
            ) : (
              <div className="m3-card m3-card-outlined m3-card-lg grid h-full min-h-0 place-items-center p-6 text-center">
                <p className="text-xs text-zinc-500">Select a lead to preview the next action.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mobile: action details open in a centered dialog. */}
      {mobileDetailsOpen && selected ? (
        <div
          className="m3-modal-scrim actions-mobile-dialog-scrim z-[120] md:!hidden"
          role="presentation"
          onClick={() => setMobileDetailsOpen(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label={selected.title}
            className="m3-modal-surface actions-mobile-sheet flex w-full flex-col overflow-hidden bg-[var(--md-sys-color-surface-container)]"
            onClick={(event) => event.stopPropagation()}
          >
            <ActionDetails
              bare
              action={selected}
              siblings={selectedLead?.actions || []}
              onSelectSibling={selectAction}
              timeZone={timeZone}
              pending={pendingId === selected.id}
              confirming={confirmingId === selected.id}
              confirmingStop={confirmingStopLeadId === selected.lead?.id}
              feedback={feedback[selected.id]}
              onConfirm={() => {
                setConfirmingStopLeadId("");
                setConfirmingId(selected.id);
              }}
              onCancel={() => setConfirmingId("")}
              onRun={() => runNow(selected)}
              onConfirmStop={() => {
                setConfirmingId("");
                setConfirmingStopLeadId(selected.lead?.id || "");
              }}
              onCancelStop={() => setConfirmingStopLeadId("")}
              onStop={() => stopOutreach(selected)}
              onClose={() => setMobileDetailsOpen(false)}
              showTimeline
            />
          </section>
        </div>
      ) : null}
    </div>
  );
}
