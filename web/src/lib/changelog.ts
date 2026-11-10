/**
 * The app's version and what changed. Each change to the app bumps the version in package.json
 * and adds a line here: minor (1.x.0) for a new feature, patch (1.1.x) for a fix.
 * The top entry must match package.json (checked by a test).
 */
export interface Release {
  version: string;
  date: string; // YYYY-MM-DD
  items: string[];
}

export const CHANGELOG: Release[] = [
  {
    version: "1.1.0",
    date: "2026-11-10",
    items: [
      "מספר גרסה בתחתית התפריט, ו\"מה חדש\" בלחיצה עליו",
      "הפעלת עתודה מתוך הלוח המפורסם, וביטול הפעלה עד תחילת התורנות",
      "חיפוש תורנות במסך התפעול, ומחיקת תורנות ממתינה שאין עליה שיבוץ",
      "תיקון: שיבוץ תורנויות חדשות לא נכשל בגלל שיבוצים מפורסמים שמפרים כלל",
      "מפתח יחידה שנשכח: החלפת מפתח בהתאמת שמות, בלי לאבד היסטוריה",
      "עריכת מועד סגירת האילוצים במסך האילוצים",
      "שלבי המחזור מתקדמים לבד לפי מה שבוצע",
      "טעינת כוח אדם: שינויים אצל חיילים קיימים נטענים רק באישור",
      "חייל חדש נכנס עם ממוצע הקבוצה שלו",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-11-09",
    items: ["פרסום המחזור הראשון: אילוצים, פוטנציאל, לוח בסיס, שיבוץ אוטומטי, לוח מפורסם ותפעול שוטף"],
  },
];

export const APP_VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
export const BUILD_SHA: string = typeof __BUILD_SHA__ === "string" ? __BUILD_SHA__ : "dev";
export const BUILD_DATE: string = typeof __BUILD_DATE__ === "string" ? __BUILD_DATE__ : "";
