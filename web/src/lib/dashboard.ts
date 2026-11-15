/** Version 2.0, stage 2.6: the unit commander's dashboard. */

export interface UnitDashboard {
  cycle: { id: string; name: string; start_date: string; end_date: string } | null;
  planning: { name: string; status: string; deadline: string | null } | null;
  by_gaf: { gaf: string; soldiers: number; duties: number; points: number }[];
  by_population: { population: "mandatory" | "career"; soldiers: number; mean: number; min: number; max: number; without: number }[];
  requests: { pending: number; urgent: number; by_soldiers: number };
  accounts: { soldiers: number; with_account: number };
  settings_changes: { at: string; action: string; entity: string; name: string | null; by: string | null }[];
}

export const ENTITY_LABEL: Record<string, string> = {
  settings: "הגדרות",
  task_types: "סוג תורנות",
  score_multipliers: "מקדם ניקוד",
  exemption_types: "סוג פטור",
  absence_types: "סוג היעדרות",
  load_roles: "תפקיד הקלה",
  ranks: "דרגה",
  duty_categories: "קטגוריית תורנות",
  populations: "אוכלוסייה",
  day_types: "סוג יום",
  calendar_days: "לוח חגים",
  exemption_type_duties: "פטור ← תורנויות",
};

export const ACTION_LABEL: Record<string, string> = { insert: "נוסף", update: "עודכן", delete: "נמחק" };

/** Points per soldier of a gaf – the load compared across gafs. */
export const perSoldier = (g: { soldiers: number; points: number }) => (g.soldiers ? g.points / g.soldiers : 0);
