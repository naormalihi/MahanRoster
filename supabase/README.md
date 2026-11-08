# שכבת הנתונים (Supabase)

## מיגרציות

| קובץ | תוכן |
| --- | --- |
| `20261105000001_core.sql` | כל הטבלאות: מבנה ארגוני, קטלוג תורנויות, חיילים, משתמשים ותפקידים, מחזורים, משבצות, שיבוצים, פטורים, היעדרויות, חסימות, קנסות, ערעורים, החלפות, הגדרות ויומן ביקורת |
| `20261105000002_security.sql` | RLS לכל טבלה, פונקציות התפקיד, טריגר יומן הביקורת, והתצוגה `published_board` |
| `20261105000003_solver_io.sql` | הגשר למנוע השיבוץ: `snapshot_cycle`, `build_solver_input`, `request_schedule`, `apply_solver_result`, `publish_cycle` |

### עקרונות

- **אין מספר אישי:** החייל מזוהה ב-`soldier_key`, HMAC-SHA256 שמחושב בדפדפן. אילוץ בטבלה דוחה כל ערך שאינו 64 תווים הקסדצימליים.
- **אין מידע רפואי:** בפטור נשמרים רק הסוג, התאריכים וסימון "אסמכתא נבדקה". פטור לא יכול לקבל סטטוס "מאושר" בלי הסימון.
- **מוכן לגרסה 2.0:** כל רשומה שבגרסה 2.0 החייל יזין בעצמו כוללת את השדות `on_behalf_of`, `received_via` ו-`received_at`.

## הרשאות בגרסה 1.0

| תפקיד | גישה |
| --- | --- |
| `coordinator` (נע"ת) | הכול, כולל ניהול משתמשים ותפקידים |
| `deputy` (ממלא מקום) | הכול, רק בתוך חלון ההאצלה, ובלי הרשאה לנהל תפקידים |
| `viewer` (חשבון הצפייה המשותף) | רק התצוגה `published_board`: משבצות שפורסמו, שמות וגפים. אין לו גישה לאף טבלה |
| אנונימי | כלום |

יומן הביקורת מתעד כל שינוי בטבלאות המרכזיות. אי אפשר לשנות או למחוק בו רשומות, גם לא דרך service_role.

## זרימת השיבוץ

1. נע"ת קורא ל-`request_schedule(cycle)`. אם אין למחזור צילום מצב, הפונקציה יוצרת אותו: דרגה במועד החישוב, אוכלוסיות, ניקוד בסיס בחלון של חצי שנה, סופ"שים ועתודות. אחר כך היא בונה את קלט המנוע ומוסיפה ריצה ל-`schedule_jobs` בסטטוס queued.
2. ה-worker (`python -m mahanroster_solver.worker`, ב-Cloud Run Job) מושך ריצה, פותר חודש אחרי חודש, ומעביר את התוצאה לבודק הכללים העצמאי.
3. אם הבודק מצא הפרה, התוצאה לא נשמרת בכלל. אחרת היא נשמרת כטיוטה דרך `apply_solver_result`, והעתודות מוצמדות למבצעים.
4. נע"ת עובר על הטיוטה ומפרסם עם `publish_cycle`, ומאותו רגע המחזור מופיע בלוח המפורסם.

ריצה במצב `stability` שומרת את כל השיבוצים שכבר פורסמו, וממלאת רק את מה שחסר.

## בדיקות

```bash
pip install -e "solver[dev,worker]"
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres pytest -q supabase/tests
```

הבדיקות יוצרות מסד נתונים חדש, מריצות את `tests/supabase_stub.sql` (רק התפקידים ו-`auth.uid()` של Supabase) ואחריו את כל המיגרציות, וזורעות יחידה פיקטיבית. הן בודקות RLS לכל תפקיד, את יומן הביקורת, את האילוצים, ואת הסבב המלא דרך המנוע: צילום מצב, קלט, פתרון, שמירה, פרסום ולוח.

## פריסה ל-Supabase

1. יוצרים פרויקט Supabase חדש.
2. באזור **Authentication › Providers › Email** מכבים את **Confirm email**. שמות המשתמשים ממופים לכתובות `username@users.invalid`, ולכתובות האלה אין תיבת דואר.
3. מריצים את המיגרציות בסדר, דרך `supabase db push` או דרך עורך ה-SQL. את `tests/supabase_stub.sql` **לא מריצים** על פרויקט אמיתי.
4. יוצרים את המשתמש הראשון ב-Auth, ומריצים:
   `insert into app_users (id, username) values ('<uid>', 'naat'); insert into user_roles (user_id, role) values ('<uid>', 'coordinator');`

## Start over: delete all cycles and soldiers

Irreversible. Run `reset_cycles_and_soldiers.sql` in Supabase › SQL Editor. It deletes every cycle
(slots, runs, assignments, constraints) and every soldier (exemptions, absences, history, roster
imports), and copies those tables to schema `reset_backup` first. Kept: catalog, settings, holidays,
gafim, users (their link to a soldier is cleared) and the audit log.
When sure: `drop schema reset_backup cascade;`
