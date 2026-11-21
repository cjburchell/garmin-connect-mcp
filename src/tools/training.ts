import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { ToolContext } from './define.js';
import { checkRange, startDate, endDate } from './schemas.js';
import { describeError } from '../garmin/errors.js';

export const trainingSchema = z.object({
  startDate: startDate(), endDate: endDate('At most 366 days.'),
  activityType: z.string().regex(/^[a-z_]+$/).max(64).optional().describe('Optional Garmin parent activity type, such as running or cycling.'),
}).strict();
type Activity = Record<string, unknown>;
const numeric = (a: Activity, key: string): number | null => typeof a[key] === 'number' && Number.isFinite(a[key]) && (a[key] as number) >= 0 ? a[key] as number : null;

export function aggregateActivities(activities: Activity[]) {
  const metric = (key: string) => {
    const values = activities.map(a => numeric(a, key)).filter((v): v is number => v !== null);
    return { value: values.length ? values.reduce((a, b) => a + b, 0) : null, recordedActivities: values.length };
  };
  const hr = activities.map(a => numeric(a, 'averageHR')).filter((v): v is number => v !== null && v > 0);
  const maxHr = activities.map(a => numeric(a, 'maxHR')).filter((v): v is number => v !== null && v > 0);
  return { totalActivities: activities.length, durationSeconds: metric('duration'), distanceMeters: metric('distance'),
    elevationGainMeters: metric('elevationGain'), averageActivityHeartRateBpm: hr.length ? hr.reduce((a,b) => a+b, 0)/hr.length : null,
    maxHeartRateBpm: maxHr.length ? Math.max(...maxHr) : null,
    heartRateNote: 'Average is an unweighted mean of recorded activity averages; null means unavailable.' };
}

export async function trainingSummary(input: unknown, ctx: ToolContext) {
  const args = trainingSchema.parse(input);
  const problem = checkRange(args.startDate, args.endDate, 366);
  if (problem) throw new Error(problem);
  const collected: Activity[] = [];
  let complete = false;
  const started = Date.now();
  // At most 5 pages / 500 activities; one call never scans an unbounded history.
  for (let page = 0; page < 5; page++) {
    if (Date.now() - started >= 60_000) break;
    const response = await ctx.client.getJson('/activitylist-service/activities/search/activities', {
      startDate: args.startDate, endDate: args.endDate, activityType: args.activityType, start: page * 100, limit: 100,
    });
    if (response.noData) { complete = true; break; }
    if (!Array.isArray(response.data)) throw new Error('Unexpected Garmin activity response; expected an array.');
    if (response.data.length > 100) throw new Error('Garmin exceeded the requested page limit.');
    for (const entry of response.data) {
      if (!entry || typeof entry !== 'object') throw new Error('Invalid Garmin activity record.');
      const day = String(entry.startTimeLocal ?? '').slice(0,10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Activity has no usable local date; cannot assign weekly statistics.');
      if (day >= args.startDate && day <= args.endDate) collected.push(entry);
    }
    if (response.data.length < 100) { complete = true; break; }
  }
  const unique = [...new Map(collected.map((a, i) => [a.activityId ?? `missing-${i}`, a])).values()];
  const weeks = new Map<string, Activity[]>();
  for (const activity of unique) {
    const day = new Date(String(activity.startTimeLocal).slice(0,10) + 'T00:00:00Z');
    day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
    const week = day.toISOString().slice(0,10);
    weeks.set(week, [...(weeks.get(week) ?? []), activity]);
  }
  return { startDate: args.startDate, endDate: args.endDate, complete, activityLimit: 500,
    warning: complete ? null : 'Partial totals: activity or time limit reached. Request a smaller date range.',
    ...aggregateActivities(unique), weekly: [...weeks].sort(([a],[b]) => a.localeCompare(b)).map(([weekStart, values]) => ({ weekStart, ...aggregateActivities(values) })) };
}

export function registerTrainingTool(server: McpServer, ctx: ToolContext) {
  server.registerTool('garmin_get_training_summary', {
    title: 'Summarize training',
    description: 'Aggregate recorded activities over an inclusive date range, optionally filtered by parent activity type. Returns counts, duration in seconds, distance and elevation in meters, Monday-based weekly totals and available heart rates in bpm. Maximum 366 days and 500 activities; partial totals are explicitly marked. Missing metrics are null with coverage counts.',
    inputSchema: trainingSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async args => {
    try { return { content: [{ type: 'text' as const, text: JSON.stringify(await trainingSummary(args, ctx)) }] }; }
    catch (error) { return { isError: true, content: [{ type: 'text' as const, text: describeError(error) }] }; }
  });
}
