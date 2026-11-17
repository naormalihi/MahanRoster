import type { Me } from "./api";
import { canRead, isSoldier, isStaff, isUnitCommander } from "./api";
import type { MascotPose } from "../components/Mascot";

/** The owl's first-login tour: three short steps per kind of user, shown once and reopened from the menu. */
export type TourKind = "soldier" | "staff" | "reader";

export interface TourStep {
  pose: MascotPose;
  title: string;
  lines: string[];
  /** the last step: how to put the app on the home screen */
  install?: boolean;
}

export function tourKind(me: Me | null): TourKind | null {
  if (!me) return null;
  if (isStaff(me)) return "staff";
  if (canRead(me) || isUnitCommander(me)) return "reader";
  if (isSoldier(me)) return "soldier";
  return null;
}

const INSTALL: TourStep = {
  pose: "clipboard",
  title: "שים אותי במסך הבית",
  lines: [
    "כך תורנצ׳יק נפתח כמו אפליקציה, ואפשר לקבל התראות לטלפון.",
  ],
  install: true,
};

export const TOUR: Record<TourKind, TourStep[]> = {
  soldier: [
    {
      pose: "wave",
      title: "היי, אני תורנצ׳יק",
      lines: [
        "ב\"התורנויות שלי\" תראה מה הבא שלך, את כל התורנויות במחזור ואת הניקוד שצברת.",
        "השיבוץ נעשה לפי ניקוד – מי שעשה פחות, ישובץ קודם. כך זה נשאר הוגן.",
      ],
    },
    {
      pose: "point",
      title: "בקשות והתראות",
      lines: [
        "ב\"הבקשות שלי\" מבקשים פטור, חוסמים תאריך או מדווחים על היעדרות – לפני השיבוץ, והנע\"ת מאשר.",
        "הפעמון למעלה מודיע כשהשיבוץ פורסם, כשמשהו השתנה ויום לפני תורנות.",
      ],
    },
    INSTALL,
  ],
  staff: [
    {
      pose: "wave",
      title: "היי, אני תורנצ׳יק",
      lines: [
        "\"תמונת מצב\" מראה מה מחכה לך עכשיו: אילוצים לאישור, משבצות חסרות ומה השלב הבא במחזור.",
        "המחזור שעליו עובדים נבחר למעלה, פעם אחת לכל המסכים.",
      ],
    },
    {
      pose: "point",
      title: "מתכננים, משבצים, מפרסמים",
      lines: [
        "ב\"תכנון ושיבוץ\" עוברים לפי הסדר: אילוצים ← פוטנציאל ← משבצות ← שיבוץ ← ניהול שוטף.",
        "המנוע מציע טיוטה לפי הניקוד; אפשר לשנות כל משבצת ידנית, ורק אחרי \"פרסום\" החיילים רואים.",
        "ב\"כוח אדם\" מוסיפים חיילים ושולחים להם קודי הצטרפות בוואטסאפ או בדף מודפס.",
      ],
    },
    INSTALL,
  ],
  reader: [
    {
      pose: "wave",
      title: "היי, אני תורנצ׳יק",
      lines: [
        "יש לך גישת קריאה: רואים הכול, ולא משנים דבר – השינויים נעשים אצל נע\"ת התורנויות.",
        "המחזור שעליו מסתכלים נבחר למעלה.",
      ],
    },
    {
      pose: "point",
      title: "איפה מה",
      lines: [
        "\"לוח התורנויות\" – מי עושה מה ומתי. \"נתוני היחידה\" – מאזן הניקוד, עומסים ופטורים.",
        "\"תכנון ושיבוץ\" ו\"כוח אדם\" – אותם מסכים שהנע\"ת עובד בהם, לקריאה.",
      ],
    },
    INSTALL,
  ],
};

const key = (userId: string) => `mahan.tour.v1.${userId}`;

/** Whether the tour was finished or skipped on this device. Browser storage can throw – then the tour just shows. */
export function tourSeen(userId: string, store: Pick<Storage, "getItem"> | null = safeStorage()): boolean {
  try {
    return store?.getItem(key(userId)) === "1";
  } catch {
    return false;
  }
}

export function markTourSeen(userId: string, store: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    store?.setItem(key(userId), "1");
  } catch {
    /* nothing to do */
  }
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
