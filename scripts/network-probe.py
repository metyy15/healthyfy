#!/usr/bin/env python3
"""
Network test: message the published Healthyfy agent through Agentverse.

This is the same path ASI:One uses. The sender resolves the agent's
endpoint through the Almanac, posts to the Agentverse mailbox, and the
agent picks the message up from its own mailbox and answers.

    cd services/healthyfy-agent
    .venv/bin/python ../../scripts/network-probe.py

The agent must be running (it polls its own mailbox) and the mailbox
must have been created from the Agentverse inspector. Run
``./scripts/agent-status.sh`` to check both.

The sender binds its own HTTP server to port 8001 so it does not
collide with the agent on port 8000.
"""
from __future__ import annotations

import os
import sys
import threading

from uagents import Agent, Context
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    TextContent,
)

TARGET = os.environ.get(
    "HEALTHYFY_AGENT_ADDRESS",
    "agent1qfvy7fwvsrwyrh9ry562s6uyusaamv6qdxxaaczd3zpg5kvgprsnytl2clc",
)
QUESTION = os.environ.get(
    "HEALTHYFY_PROBE_QUESTION",
    "What changed in my father's health recently, and what should I ask his doctor?",
)
TIMEOUT_SECONDS = int(os.environ.get("HEALTHYFY_PROBE_TIMEOUT", "170"))
PORT = int(os.environ.get("HEALTHYFY_PROBE_PORT", "8001"))

sender = Agent(
    name="healthyfy-probe",
    seed="probe probe probe probe probe probe probe probe probe probe probe probe",
    port=PORT,
)


@sender.on_message(model=ChatMessage)
async def on_reply(ctx: Context, sender_address: str, msg: ChatMessage) -> None:
    print("\n=== REPLY FROM THE HEALTHYFY AGENT ===")
    print(msg.text())
    print("=== END OF REPLY ===")
    sys.stdout.flush()
    os._exit(0)


@sender.on_message(model=ChatAcknowledgement)
async def on_ack(ctx: Context, sender_address: str, msg: ChatAcknowledgement) -> None:
    print("[probe] the agent acknowledged the message")
    sys.stdout.flush()


_sent = {"done": False}


@sender.on_interval(period=0.5)
async def send(ctx: Context) -> None:
    # The context is rebuilt on every interval tick, so the flag has to
    # live outside it or the message is sent over and over.
    if _sent["done"]:
        return
    _sent["done"] = True
    print(f"[probe] posting a chat message to {TARGET} through the Agentverse mailbox")
    sys.stdout.flush()
    try:
        await ctx.send(TARGET, ChatMessage(content=[TextContent(text=QUESTION)]))
        print("[probe] message handed to the uagents transport")
    except Exception as exc:  # noqa: BLE001
        print(f"[probe] send raised: {exc!r}")
    sys.stdout.flush()


def bail() -> None:
    print("[probe] timed out waiting for a reply")
    print("        Check that the agent is running and its mailbox exists:")
    print("        ./scripts/agent-status.sh")
    sys.stdout.flush()
    os._exit(1)


if __name__ == "__main__":
    threading.Timer(TIMEOUT_SECONDS, bail).start()
    print(f"[probe] resolving {TARGET} through the Almanac")
    sender.run()
