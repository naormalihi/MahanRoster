"""Version 2.0, stage 2.5 – pushes queued notifications to the soldiers' phones (Web Push).

Run by the notify workflow: woken by the database when notifications are queued, and every
15 minutes for the day-before reminders. Reads the VAPID private key from Supabase Vault –
it is never printed or stored anywhere else. Uses DATABASE_URL (the SUPABASE_DB_URL secret).

    python notify_worker.py           # queue reminders, push what waits
    python notify_worker.py --setup   # make the VAPID key pair once (no-op if it exists)
"""

from __future__ import annotations

import json
import os
import sys

import psycopg

GONE = {404, 410}  # the browser dropped the subscription


def setup(conn) -> None:
    from cryptography.hazmat.primitives import serialization
    from py_vapid import Vapid
    from py_vapid.utils import b64urlencode

    have = conn.execute("select count(*) from vault.secrets where name = 'vapid_private_key'").fetchone()[0]
    pub = conn.execute("select value #>> '{}' from settings where key = 'vapid_public_key'").fetchone()
    if have and pub:
        print("VAPID keys already set up – nothing to do")
        return
    v = Vapid()
    v.generate_keys()
    pem = v.private_pem().decode()
    public = b64urlencode(v.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))
    if have:
        conn.execute("delete from vault.secrets where name = 'vapid_private_key'")
    conn.execute("select vault.create_secret(%s, 'vapid_private_key', 'Web Push (MahanRoster notify worker)')", (pem,))
    conn.execute(
        "insert into settings (key, value) values ('vapid_public_key', to_jsonb(%s::text)) "
        "on conflict (key) do update set value = excluded.value",
        (public,),
    )
    print("VAPID keys created: the private key is in Vault, the public key in settings")


def push(conn) -> int:
    from py_vapid import Vapid
    from pywebpush import WebPushException, webpush

    queued = conn.execute("select app.queue_reminders()").fetchone()[0]
    print(f"reminders queued: {queued}")
    row = conn.execute("select decrypted_secret from vault.decrypted_secrets where name = 'vapid_private_key'").fetchone()
    if not row:
        print("no VAPID key – run the push-setup workflow once")
        return 0
    vapid = Vapid.from_pem(row[0].encode())
    items = conn.execute(
        """select n.id, n.payload, n.type, s.id, s.endpoint, s.p256dh, s.auth
           from notifications n join push_subscriptions s on s.user_id = n.recipient_user_id
           where n.pushed_at is null and n.created_at > now() - interval '2 days'
           order by n.created_at"""
    ).fetchall()
    sent, done = 0, set()
    for nid, payload, ntype, sub_id, endpoint, p256dh, auth in items:
        data = json.dumps(
            {"title": payload.get("title", "MahanRoster"), "body": payload.get("body", ""), "url": payload.get("url", "/"), "tag": str(nid), "type": ntype},
            ensure_ascii=False,
        )
        try:
            webpush(
                subscription_info={"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth}},
                data=data,
                vapid_private_key=vapid,
                vapid_claims={"sub": "mailto:noreply@mahanroster.invalid"},
                ttl=24 * 3600,
            )
            conn.execute("update push_subscriptions set last_ok_at = now(), failures = 0 where id = %s", (sub_id,))
            sent += 1
        except WebPushException as e:
            status = getattr(e.response, "status_code", None)
            if status in GONE:
                conn.execute("delete from push_subscriptions where id = %s", (sub_id,))
            else:
                conn.execute("update push_subscriptions set failures = failures + 1 where id = %s", (sub_id,))
                print(f"push failed ({status}) for a subscription")
        done.add(nid)
    # every notification of the last two days is now handled (pushed, or nobody to push it to)
    conn.execute("update notifications set pushed_at = now() where pushed_at is null and created_at > now() - interval '2 days'")
    print(f"pushed {sent} to {len(done)} notifications")
    return sent


def main() -> int:
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 1
    with psycopg.connect(url, autocommit=True) as conn:
        if "--setup" in sys.argv:
            setup(conn)
        else:
            push(conn)
    return 0


if __name__ == "__main__":
    sys.exit(main())
