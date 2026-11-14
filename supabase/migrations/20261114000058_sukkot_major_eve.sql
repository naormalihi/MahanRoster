-- ערב סוכות joins the major holiday eves (ערב ראש השנה, ערב יום כיפור, ערב פסח): its day type
-- becomes "ערב חג מרכזי", so every multiplier on that day type now applies to it too.
-- Days entered by hand under another name are left as they are.
update calendar_days set day_type = 'major_holiday_eve'
 where note = 'ערב סוכות' and day_type <> 'major_holiday_eve';
