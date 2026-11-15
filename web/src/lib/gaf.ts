/** Version 2.0, stage 2.3: the gaf's own screen – representative and commander. */

export interface GafOverview {
  gaf: { id: string; name: string };
  is_commander: boolean;
  cycle: { id: string; name: string; start_date: string; end_date: string; status: string; deadline: string | null; open: boolean };
  soldiers: { id: string; name: string; rank: string | null; has_account: boolean }[];
  exemptions: { id: string; soldier_id: string; type: string; start_date: string; end_date: string; status: string; is_urgent: boolean; by_soldier: boolean }[];
  blocks: { id: string; soldier_id: string; day: string; by_soldier: boolean }[];
  absences: { id: string; soldier_id: string; type: string; starts_at: string; ends_at: string; by_soldier: boolean }[];
  submission: { status: "open" | "submitted" | "approved" | "late"; submitted_at: string | null; submitted_by: string | null; approved_at: string | null; approved_by: string | null } | null;
  comments: { id: string; slot_id: string | null; text: string; status: "open" | "handled"; author: string | null; created_at: string }[];
  duties: { assignment_id: string; slot_id: string; soldier_id: string; task: string; starts_at: string; ends_at: string; role: "performer" | "reserve"; status: string }[];
}

export interface GafReports {
  submissions: { gaf: string; status: string | null; submitted_at: string | null; approved_at: string | null; approved_by: string | null }[];
  comments: { id: string; gaf: string | null; slot_id: string | null; text: string; status: "open" | "handled"; author: string | null; created_at: string }[];
}

export const SUBMISSION_LABEL: Record<string, string> = {
  open: "בעבודה",
  submitted: "הוגש למפקד הגף",
  approved: "אושר ע\"י מפקד הגף",
  late: "אושר אחרי מועד הסגירה",
};

/** Per soldier: how many constraints he has in the cycle, for the gaf's table. */
export function constraintCounts(o: GafOverview): Map<string, number> {
  const m = new Map<string, number>();
  const add = (id: string) => m.set(id, (m.get(id) ?? 0) + 1);
  o.exemptions.forEach((e) => add(e.soldier_id));
  o.blocks.forEach((b) => add(b.soldier_id));
  o.absences.forEach((a) => add(a.soldier_id));
  return m;
}
