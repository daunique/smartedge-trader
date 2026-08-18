"""
Telegram signal / trade alerts.

Fly secrets:
  TELEGRAM_BOT_TOKEN=123456:ABC...
  TELEGRAM_CHAT_ID=123456789   (or -100... for groups)

Create bot via @BotFather, then message the bot once, get chat id via
  https://api.telegram.org/bot<TOKEN>/getUpdates
"""

from __future__ import annotations

import os
from typing import Optional

import httpx

_last_signal_ids: set[str] = set()


def enabled() -> bool:
    return bool((os.getenv("TELEGRAM_BOT_TOKEN") or "").strip()
                and (os.getenv("TELEGRAM_CHAT_ID") or "").strip())


async def send_message(text: str, parse_mode: str = "HTML") -> bool:
    token = (os.getenv("TELEGRAM_BOT_TOKEN") or "").strip()
    chat_id = (os.getenv("TELEGRAM_CHAT_ID") or "").strip()
    if not token or not chat_id:
        return False
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text[:4000],
        "parse_mode": parse_mode,
        "disable_web_page_preview": True,
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(url, json=payload)
            data = r.json() if r.content else {}
            if not data.get("ok"):
                print(f"[TELEGRAM] send failed: {data}")
                return False
            return True
    except Exception as e:
        print(f"[TELEGRAM] error: {e}")
        return False


async def notify_signal(sig: dict) -> None:
    """Alert on a new strategy signal (deduped by id)."""
    if not enabled():
        return
    sid = str(sig.get("id") or "")
    if sid and sid in _last_signal_ids:
        return
    if sid:
        _last_signal_ids.add(sid)
        if len(_last_signal_ids) > 200:
            _last_signal_ids.clear()

    direction = sig.get("direction") or "?"
    symbol = sig.get("symbol") or "XRPUSDT"
    entry = sig.get("entry")
    tp = sig.get("tp")
    sl = sig.get("sl")
    be = sig.get("be")
    rr = sig.get("rr") or "1:3"
    trend = sig.get("trend") or ""
    trigger = sig.get("entry_trigger") or sig.get("entryTrigger") or ""

    arrow = "🟢 LONG" if direction == "LONG" else "🔴 SHORT"
    text = (
        f"<b>SmartEdge Signal</b>\n"
        f"{arrow} <b>{symbol}</b> · 1H\n"
        f"Entry: <code>{entry}</code>\n"
        f"SL: <code>{sl}</code> · TP: <code>{tp}</code>\n"
        f"BE: <code>{be}</code> · RR {rr}\n"
    )
    if trend or trigger:
        text += f"Trend: {trend} · Trigger: {trigger}\n"
    text += f"Mode: signal ready"
    ok = await send_message(text)
    if ok:
        print(f"[TELEGRAM] signal sent {direction} {symbol}")


async def notify_trade(result: dict) -> None:
    if not enabled() or not result.get("success"):
        return
    direction = result.get("direction") or "?"
    symbol = result.get("symbol") or "XRPUSDT"
    qty = result.get("qty")
    entry = result.get("entry")
    tp = result.get("tp")
    sl = result.get("sl")
    order_id = result.get("order_id") or ""
    arrow = "🟢 LONG" if direction == "LONG" else "🔴 SHORT"
    text = (
        f"<b>SmartEdge Order Filled</b>\n"
        f"{arrow} <b>{symbol}</b>\n"
        f"Qty: <code>{qty}</code> · Entry ~ <code>{entry}</code>\n"
        f"SL: <code>{sl}</code> · TP: <code>{tp}</code>\n"
        f"Order: <code>{order_id}</code>"
    )
    await send_message(text)


async def notify_error(title: str, detail: str) -> None:
    if not enabled():
        return
    await send_message(f"<b>{title}</b>\n<code>{detail[:500]}</code>")
