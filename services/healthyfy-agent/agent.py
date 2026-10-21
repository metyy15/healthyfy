"""Healthyfy health agent — a uAgent on Agentverse backed by ASI:One.

The agent exposes the Healthyfy family-care records in two ways:

* **Agent Chat Protocol (ACP).** ASI:One Chat (and anything else that
  speaks ACP) can hold a conversation with this agent. The agent
  acknowledges every message, then runs a real tool-calling loop
  against the Healthyfy REST API and answers from the records it
  actually read.
* **A domain protocol.** Other Fetch.ai agents can call this agent as
  a tool by sending a :class:`~protocol.HealthRequest` and reading the
  structured :class:`~protocol.HealthResponse` that comes back.

ASI:One is the brain, but it is not the source of truth. The model is
given tools that read the Healthyfy API; it has to call them before it
can say anything about a family member's health.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from dataclasses import dataclass, field
from typing import Any

from openai import OpenAI
from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    TextContent,
    chat_protocol_spec,
)
from uagents_core.models import Field, Model

try:  # pragma: no cover - depends on the optional litellm extra
    from uagents.experimental.chat_agent.protocol import build_llm_message_history
except ModuleNotFoundError:
    # `uagents.experimental.chat_agent` imports litellm at package level, so
    # pulling the helper from there drags in a large optional dependency.
    # The helper is small, so mirror it here and keep the install light.
    def build_llm_message_history(ctx: Context) -> list[dict[str, str]]:
        history: list[dict[str, str]] = []

        try:
            entries = ctx.session_history() or []
        except Exception:  # noqa: BLE001
            # The agent may not be storing message history. The thread is
            # a nicety; failing to read it must never lose the reply.
            return history

        for entry in entries:
            payload = entry.payload
            if not payload:
                continue

            try:
                hist_msg = ChatMessage.parse_raw(payload)
            except Exception:
                continue

            text = hist_msg.text().strip()
            if not text:
                continue

            role = "assistant" if entry.sender == ctx.agent.address else "user"
            history.append({"role": role, "content": text})

        return history

from healthyfy_client import HealthyfyClient
from protocol import HealthProtocol, HealthRequest, HealthResponse

logger = logging.getLogger("healthyfy.agent")

# -------------------------------------------------------------
# Configuration
# -------------------------------------------------------------


def _load_dotenv(path: str = ".env") -> None:
    """Read a ``.env`` file into the environment without extra dependencies.

    Existing environment variables always win, so a value exported by
    the shell or by the container overrides the file.
    """
    if not os.path.isfile(path):
        return
    try:
        with open(path, encoding="utf-8") as handle:
            for raw_line in handle:
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key:
                    os.environ.setdefault(key, value)
    except OSError as exc:
        logger.warning("Could not read %s: %s", path, exc)


_load_dotenv()


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


ASI1_API_KEY = _env("ASI1_API_KEY")
ASI1_BASE_URL = _env("ASI1_BASE_URL", "https://api.asi1.ai/v1")
ASI1_MODEL = _env("ASI1_MODEL", "asi1")

AGENTVERSE_TOKEN = _env("AGENTVERSE_TOKEN") or _env("AGENTVERSE_API_KEY")
AGENT_NAME = _env("HEALTHYFY_AGENT_NAME", "healthyfy-health-agent")
AGENT_SEED = _env("HEALTHYFY_AGENT_SEED")
AGENT_PORT = int(_env("HEALTHYFY_AGENT_PORT", "8000") or "8000")
AGENT_HANDLE = _env("HEALTHYFY_AGENT_HANDLE", "healthyfy")

# The published profile. This is the text ASI:One's planner reads when it
# decides which agent to route a request to, so it names the concrete
# things this agent can do rather than describing the product.
AGENT_DESCRIPTION = (
    "Reads a family's real medical records and answers questions about them: "
    "lab reports and their values, medication lists, allergy history, medication "
    "adherence, monitoring data and health alerts. Compares two lab reports and "
    "reports how each test value changed with its reference range. Checks a "
    "medication list against recorded allergies, other medications and conditions "
    "using the FDA drug labels. Lists outstanding follow-up tasks. Does not "
    "diagnose, does not change medication schedules, and never invents a value."
)

# The profile README published to Agentverse. Kept separate from the long
# developer README so the published profile stays readable.
PROFILE_README = _env("HEALTHYFY_AGENT_PROFILE", "profile.md")

HEALTHYFY_BASE_URL = _env("HEALTHYFY_BASE_URL", "http://localhost:3000")
HEALTHYFY_EMAIL = _env("HEALTHYFY_EMAIL", "kartik@healthyfy.ai")
HEALTHYFY_PASSWORD = _env("HEALTHYFY_PASSWORD", "healthyfy123")
DEFAULT_MEMBER = _env("HEALTHYFY_DEFAULT_MEMBER")

#: How many tool-calling turns the model gets before we take the answer.
MAX_TOOL_TURNS = int(_env("HEALTHYFY_MAX_TOOL_TURNS", "4") or "4")
# ASI:One is often briefly overloaded. It says how long to wait, so the
# agent waits that long and tries again rather than giving up.
MODEL_MAX_ATTEMPTS = int(_env("HEALTHYFY_MODEL_ATTEMPTS", "3") or "3")
MODEL_RETRY_BASE_SECONDS = float(_env("HEALTHYFY_MODEL_RETRY_WAIT", "6") or "6")


def _is_overloaded(exc: Exception) -> bool:
    """Whether the failure looks like a temporary overload worth retrying."""
    text = str(exc).lower()
    return (
        "503" in text
        or "overloaded" in text
        or "server_error" in text
        or "temporarily" in text
        or "rate_limit" in text
        or "429" in text
    )


def _retry_after_seconds(exc: Exception) -> float:
    """The wait ASI:One asked for, if it said."""
    text = str(exc)
    match = re.search(r"retry_after_seconds['\"]?\s*[:=]\s*(\d+)", text)
    if match:
        try:
            return max(1.0, min(30.0, float(match.group(1))))
        except ValueError:
            pass
    return MODEL_RETRY_BASE_SECONDS

DISCLAIMER = (
    "This is educational information from your own Healthyfy records, not a diagnosis. "
    "Please discuss it with your doctor or pharmacist before changing anything."
)

SYSTEM_INSTRUCTION = f"""You are Healthyfy, a family health assistant that answers questions \
about a family's own medical records, held in the Healthyfy app.

HOW YOU WORK
- You have tools that read the real Healthyfy records: medical reports and lab values, \
medications, allergies, the medication adherence log, recent vitals, open health alerts, \
the daily briefing, the exercise plan, and the allergy/interaction safety check.
- Always call the tools you need before you answer. Never guess, recall or assume a lab \
value, a medication, a dose or a date: if it is not in a tool result, it is not in the record.
- Use the tools for the family member the question is about. If you are not sure which \
member is meant, call list_family_members first.
- Answer only from what the tools returned. If the records do not contain the answer, say \
so plainly instead of filling the gap with general knowledge.
- Quote the actual numbers you saw, with their units and the report they came from, and name \
the report and its date.

SAFETY RULES (these are not negotiable)
- You provide educational information and help the family understand their own records. You \
do not diagnose, and you never state or imply a diagnosis.
- Never suggest changing, starting, stopping, skipping or adjusting a medication or a dose. \
If the family asks what to do about a medicine, describe what is on record and tell them to \
talk to the prescriber or pharmacist.
- If the question describes an emergency (chest pain, trouble breathing, signs of a stroke, \
loss of consciousness, severe bleeding, a fall with an injury, suicidal thoughts, or a \
dangerous heart rate or oxygen level), put this first in your reply: they should call their \
local emergency number or go to the nearest emergency department right now.
- Do not invent records, do not claim you checked something you did not, and never mix up \
one family member's data with another's.

STYLE
- Plain language, warm but precise. Short paragraphs or a few bullets.
- Name the family member you are talking about.
- End your reply with the disclaimer line, exactly as written, on its own line:
{DISCLAIMER}"""

#: Endpoint labels used to report which Healthyfy data was consulted.
SOURCE_LABELS = {
    "get_medical_reports": "/api/records",
    "get_medications": "/api/medications",
    "get_allergies": "/api/allergies",
    "get_adherence_log": "/api/adherence",
    "get_vitals": "/api/vitals",
    "get_open_alerts": "/api/alerts",
    "get_daily_briefing": "/api/briefing",
    "get_exercise_plan": "/api/exercise-plan",
    "run_safety_check": "/api/safety/check",
    "raise_health_alert": "/api/alerts",
    "list_family_members": "/api/family",
    "compare_reports": "/api/records/compare",
    "list_follow_ups": "/api/follow-up/upcoming",
}


# -------------------------------------------------------------
# Tool definitions (OpenAI function-calling schema)
# -------------------------------------------------------------


def _function_tool(
    name: str,
    description: str,
    properties: dict[str, Any] | None = None,
    required: list[str] | None = None,
) -> dict[str, Any]:
    """Build one OpenAI-style function tool."""
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties or {},
                "required": required or [],
            },
        },
    }


_MEMBER_ID_PROPERTY = {
    "member_id": {
        "type": "string",
        "description": (
            "Family member id. Leave empty to use the family member the question is about."
        ),
    }
}


def build_tools(
    include_vitals: bool = True, include_adherence: bool = True
) -> list[dict[str, Any]]:
    """The tool catalogue handed to ASI:One for one turn."""
    tools = [
        _function_tool(
            "list_family_members",
            "List the family members on this Healthyfy account with their id, name and "
            "relationship. Use it when it is unclear which member a question is about.",
        ),
        _function_tool(
            "get_medical_reports",
            "Get the medical reports (lab panels and their individual values) for a family "
            "member. Use it for anything about test results, diagnoses mentioned in reports "
            "or report dates.",
            _MEMBER_ID_PROPERTY,
        ),
        _function_tool(
            "get_medications",
            "Get the medication list for a family member: name, dose, frequency, times and "
            "instructions.",
            _MEMBER_ID_PROPERTY,
        ),
        _function_tool(
            "get_allergies",
            "Get the recorded allergies for a family member: substance, reaction and severity.",
            _MEMBER_ID_PROPERTY,
        ),
        _function_tool(
            "get_open_alerts",
            "Get the unresolved health alerts for a family member: severity, title, message "
            "and when they were detected.",
            _MEMBER_ID_PROPERTY,
        ),
        _function_tool(
            "get_daily_briefing",
            "Get the daily briefing for the account: the narrative, the insights and the "
            "questions worth asking the doctor.",
        ),
        _function_tool(
            "get_exercise_plan",
            "Get the exercise plan for a family member: the weekly targets, the basis behind "
            "them and the safety notes.",
            _MEMBER_ID_PROPERTY,
        ),
        _function_tool(
            "compare_reports",
            "Compare two medical reports for a family member and report how each test value "
            "changed, with the reference range for each. Use this whenever someone asks what "
            "changed, whether a result has improved, or how two reports differ. By default it "
            "compares the two most recent reports of the same panel.",
            {
                **_MEMBER_ID_PROPERTY,
                "older_id": {
                    "type": "string",
                    "description": (
                        "Id of the earlier report. Leave empty to use the most recent earlier "
                        "report of the same panel."
                    ),
                },
                "latest_id": {
                    "type": "string",
                    "description": "Id of the later report. Leave empty to use the most recent report.",
                },
            },
        ),
        _function_tool(
            "list_follow_ups",
            "List the follow-up tasks that are still outstanding for a family member, grouped by "
            "overdue, due today, due this week and later. Use this when someone asks what they "
            "need to do, what is pending, or what is coming up.",
            {
                **_MEMBER_ID_PROPERTY,
                "days": {
                    "type": "integer",
                    "description": "How many days ahead to look. Default 7.",
                },
            },
        ),
        _function_tool(
            "run_safety_check",
            "Run the allergy and interaction safety check for a medication list against a "
            "family member's records. Returns the highest severity and the findings.",
            {
                **_MEMBER_ID_PROPERTY,
                "medications": {
                    "type": "array",
                    "description": "The medications to check.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "dose": {"type": "string"},
                        },
                        "required": ["name"],
                    },
                },
            },
            ["medications"],
        ),
        _function_tool(
            "raise_health_alert",
            "Raise a health alert for a family member so the family and the linked caregivers "
            "are notified. Only use this when the family explicitly asks for an alert to be "
            "raised.",
            {
                **_MEMBER_ID_PROPERTY,
                "type": {
                    "type": "string",
                    "description": (
                        "Alert type: heart_rate, fall, spo2, inactivity, medication_missed, "
                        "safety or manual."
                    ),
                },
                "severity": {
                    "type": "string",
                    "description": "One of info, warning or critical.",
                },
                "title": {"type": "string", "description": "Short alert title."},
                "message": {"type": "string", "description": "What happened."},
            },
            ["title", "message"],
        ),
    ]

    if include_adherence:
        tools.append(
            _function_tool(
                "get_adherence_log",
                "Get the medication adherence log for a family member: every scheduled dose, "
                "whether it was taken, skipped or late, plus the adherence rate.",
                {
                    **_MEMBER_ID_PROPERTY,
                    "days": {
                        "type": "integer",
                        "description": "How many days back to look. Defaults to 14.",
                    },
                },
            )
        )

    if include_vitals:
        tools.append(
            _function_tool(
                "get_vitals",
                "Get the recent vital readings for a family member: heart rate, steps, SpO2, "
                "blood pressure, sleep, weight and temperature, with the time and context.",
                {
                    **_MEMBER_ID_PROPERTY,
                    "type": {
                        "type": "string",
                        "description": (
                            "Optional vital type, for example heart_rate, steps, spo2, "
                            "blood_pressure, sleep_hours, weight or temperature."
                        ),
                    },
                    "hours": {
                        "type": "integer",
                        "description": "How many hours back to look. Defaults to 24.",
                    },
                },
            )
        )

    return tools


# -------------------------------------------------------------
# Result holders
# -------------------------------------------------------------


@dataclass
class ToolResult:
    """What one tool call returned."""

    tool: str
    source: str
    payload: Any
    evidence: str
    record_count: int


@dataclass
class AnswerResult:
    """The outcome of one answered question."""

    answer: str
    member: dict[str, Any] | None = None
    sources: list[str] = field(default_factory=list)
    evidence: list[str] = field(default_factory=list)
    records: int = 0
    tool_calls: int = 0
    error: str | None = None


# -------------------------------------------------------------
# Healthyfy client
# -------------------------------------------------------------

_client: HealthyfyClient | None = None


def get_client() -> HealthyfyClient:
    """Return the shared Healthyfy client."""
    global _client
    if _client is None:
        _client = HealthyfyClient(
            base_url=HEALTHYFY_BASE_URL,
            email=HEALTHYFY_EMAIL,
            password=HEALTHYFY_PASSWORD,
        )
    return _client


# -------------------------------------------------------------
# Member resolution
# -------------------------------------------------------------


def _member_names(member: dict[str, Any]) -> list[str]:
    """Every string that could refer to this member."""
    names = []
    full_name = str(member.get("name") or "").strip()
    if full_name:
        names.append(full_name)
        names.append(full_name.split(" (")[0].strip())
    relationship = str(member.get("relationship") or "").strip()
    if relationship:
        names.append(relationship)
    member_id = str(member.get("id") or "").strip()
    if member_id:
        names.append(member_id)
    return [name for name in names if name]


def resolve_member(
    members: list[dict[str, Any]],
    text: str,
    default_member: str = "",
) -> dict[str, Any] | None:
    """Pick the family member a question is about.

    Order of preference: a name mentioned in the message, then the
    configured default member, then the first member on the account.
    """
    if not members:
        return None

    haystack = (text or "").lower()

    for member in members:
        for name in _member_names(member):
            if name.lower() == "self":
                continue
            if name.lower() in haystack:
                return member

    if default_member:
        wanted = default_member.lower()
        for member in members:
            if any(wanted == name.lower() for name in _member_names(member)):
                return member
        # Also allow a partial match on the name.
        for member in members:
            for name in _member_names(member):
                if wanted and wanted in name.lower():
                    return member

    return members[0]


# -------------------------------------------------------------
# Tool execution
# -------------------------------------------------------------


def _count_records(data: Any) -> int:
    """How many individual records a tool result contains."""
    if data is None:
        return 0
    if isinstance(data, list):
        return len(data)
    if isinstance(data, dict):
        for key in ("entries", "members", "findings", "alerts"):
            value = data.get(key)
            if isinstance(value, list):
                return len(value)
        return 1
    return 0


def _clip(text: Any, limit: int = 600) -> str:
    """Shorten a long string so the prompt stays small."""
    value = str(text if text is not None else "")
    if len(value) <= limit:
        return value
    return value[:limit].rstrip() + "..."


def _trim_report(report: dict[str, Any]) -> dict[str, Any]:
    """Keep the useful parts of a medical report."""
    values = []
    for value in (report.get("values") or [])[:40]:
        if not isinstance(value, dict):
            continue
        values.append(
            {
                "testName": value.get("testName"),
                "result": value.get("result"),
                "referenceRange": value.get("referenceRange"),
                "status": value.get("status"),
                "clinicalSignificance": _clip(value.get("clinicalSignificance"), 300),
            }
        )
    trimmed: dict[str, Any] = {
        "reportType": report.get("reportType"),
        "title": report.get("title"),
        "date": report.get("date"),
        "laboratory": report.get("laboratory"),
        "summary": _clip(report.get("summary"), 1200),
        "isUrgent": report.get("isUrgent"),
        "values": values,
    }
    questions = report.get("suggestedQuestions")
    if isinstance(questions, list):
        trimmed["suggestedQuestions"] = [_clip(q, 300) for q in questions[:5]]
    steps = report.get("nextSteps")
    if isinstance(steps, list):
        trimmed["nextSteps"] = [_clip(s, 300) for s in steps[:5]]
    return trimmed


def _trim_medication(medication: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": medication.get("name"),
        "dose": medication.get("dose"),
        "route": medication.get("route"),
        "frequency": medication.get("frequency"),
        "times": medication.get("times"),
        "instructions": _clip(medication.get("instructions"), 300),
        "prescribedBy": medication.get("prescribedBy"),
        "startDate": medication.get("startDate"),
        "active": medication.get("active"),
    }


def _trim_allergy(allergy: dict[str, Any]) -> dict[str, Any]:
    return {
        "substance": allergy.get("substance"),
        "reaction": allergy.get("reaction"),
        "severity": allergy.get("severity"),
        "verifiedAt": allergy.get("verifiedAt"),
    }


def _trim_follow_up(task: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": task.get("id"),
        "title": task.get("title"),
        "kind": task.get("kind"),
        "detail": _clip(task.get("detail"), 300),
        "dueDate": task.get("dueDate"),
        "dueTime": task.get("dueTime"),
        "reminderScheduled": task.get("reminderScheduled"),
        "safetyNote": _clip(task.get("safetyNote"), 300),
    }


def _trim_vital(vital: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": vital.get("type"),
        "value": vital.get("value"),
        "secondaryValue": vital.get("secondaryValue"),
        "unit": vital.get("unit"),
        "measuredAt": vital.get("measuredAt"),
        "context": vital.get("context"),
    }


def _trim_alert(alert: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": alert.get("type"),
        "severity": alert.get("severity"),
        "status": alert.get("status"),
        "title": alert.get("title"),
        "message": _clip(alert.get("message"), 500),
        "detectedAt": alert.get("detectedAt"),
    }


async def execute_tool(
    name: str,
    args: dict[str, Any],
    client: HealthyfyClient,
    member: dict[str, Any] | None,
    log: logging.Logger,
) -> ToolResult:
    """Run one tool against the Healthyfy API and summarise the result."""
    requested_id = str(args.get("member_id") or "").strip()
    member_id = requested_id or str((member or {}).get("id") or "").strip()

    if name == "list_family_members":
        members = await client.family_members()
        payload = [
            {
                "member_id": m.get("id"),
                "name": m.get("name"),
                "relationship": m.get("relationship"),
                "age": m.get("age"),
            }
            for m in members
        ]
        names = ", ".join(str(m.get("name")) for m in members)
        return ToolResult(
            tool=name,
            source=SOURCE_LABELS[name],
            payload=payload,
            evidence=f"{len(members)} family members ({names})",
            record_count=len(payload),
        )

    if name == "get_medical_reports":
        reports = await client.medical_reports(member_id)
        payload = [_trim_report(report) for report in reports]
        types = ", ".join(
            str(report.get("reportType") or "report") for report in reports[:5]
        )
        return ToolResult(
            tool=name,
            source=SOURCE_LABELS[name],
            payload=payload,
            evidence=f"{len(reports)} medical report(s)" + (f" ({types})" if types else ""),
            record_count=len(payload),
        )

    if name == "get_medications":
        medications = await client.medications(member_id)
        payload = [_trim_medication(medication) for medication in medications]
        active = sum(1 for medication in medications if medication.get("active"))
        return ToolResult(
            tool=name,
            source=SOURCE_LABELS[name],
            payload=payload,
            evidence=f"{len(medications)} medication(s), {active} active",
            record_count=len(payload),
        )

    if name == "get_allergies":
        allergies = await client.allergies(member_id)
        payload = [_trim_allergy(allergy) for allergy in allergies]
        substances = ", ".join(str(a.get("substance")) for a in allergies[:6])
        return ToolResult(
            tool=name,
            source=SOURCE_LABELS[name],
            payload=payload,
            evidence=f"{len(allergies)} recorded allergy(ies)"
            + (f" ({substances})" if substances else ""),
            record_count=len(payload),
        )

    if name == "get_adherence_log":
        days = int(args.get("days") or 14)
        adherence = await client.adherence(member_id, days=days)
        entries = adherence.get("entries") or []
        summary = adherence.get("summary") or {}
        payload = {
            "summary": summary,
            "entries": [
                {
                    "medicationName": entry.get("medicationName"),
                    "scheduledAt": entry.get("scheduledAt"),
                    "status": entry.get("status"),
                }
                for entry in entries[:60]
            ],
        }
        rate = summary.get("adherenceRate")
        rate_text = f"{rate}%" if rate is not None else "not enough answered doses"
        return ToolResult(
            tool=name,
            source=SOURCE_LABELS[name],
            payload=payload,
            evidence=f"{len(entries)} scheduled dose(s) over {days} days, adherence {rate_text}",
            record_count=len(entries),
        )

    if name == "get_vitals":
        hours = int(args.get("hours") or 24)
        vital_type = args.get("type") or None
        vitals = await client.vitals(member_id, vital_type=vital_type, hours=hours)
        payload = [_trim_vital(vital) for vital in vitals[:60]]
        kinds = ", ".join(sorted({str(vital.get("type")) for vital in vitals}))
        return ToolResult(
            tool=name,
            source=SOURCE_LABELS[name],
            payload=payload,
            evidence=f"{len(vitals)} vital reading(s) over the last {hours}h"
            + (f" ({kinds})" if kinds else ""),
            record_count=len(payload),
        )

    if name == "get_open_alerts":
        alerts = await client.open_alerts(member_id)
        payload = [_trim_alert(alert) for alert in alerts]
        critical = sum(1 for alert in alerts if alert.get("severity") == "critical")
        return ToolResult(
            tool=name,
            source=SOURCE_LABELS[name],
            payload=payload,
            evidence=f"{len(alerts)} unresolved alert(s), {critical} critical",
            record_count=len(payload),
        )

    if name == "compare_reports":
        comparison = await client.compare_reports(
            member_id,
            older_id=str(args.get("older_id") or ""),
            latest_id=str(args.get("latest_id") or ""),
        )
        if not comparison.get("comparable"):
            return ToolResult(
                tool=name,
                source=SOURCE_LABELS[name],
                payload={
                    "comparable": False,
                    "reason": _clip(comparison.get("reason"), 400),
                },
                evidence=str(comparison.get("reason") or "no comparable pair of reports"),
                record_count=0,
            )

        changes = []
        for change in comparison.get("changes") or []:
            changes.append(
                {
                    "test": change.get("testName"),
                    "unit": change.get("unit"),
                    "previous": (change.get("previous") or {}).get("raw"),
                    "latest": (change.get("latest") or {}).get("raw"),
                    "previousInRange": (change.get("previous") or {}).get("inRange"),
                    "latestInRange": (change.get("latest") or {}).get("inRange"),
                    "direction": change.get("direction"),
                    "change": change.get("absoluteChange"),
                    "percentChange": change.get("percentChange"),
                    "significance": change.get("significance"),
                    "referenceRange": (change.get("latest") or {}).get("rangeText"),
                }
            )

        older_report = comparison.get("older") or {}
        latest_report = comparison.get("latest") or {}
        return ToolResult(
            tool=name,
            source=SOURCE_LABELS[name],
            payload={
                "comparable": True,
                "older": {
                    "date": older_report.get("date"),
                    "reportType": older_report.get("reportType"),
                },
                "latest": {
                    "date": latest_report.get("date"),
                    "reportType": latest_report.get("reportType"),
                },
                "changes": changes,
                "notCompared": comparison.get("skipped") or [],
                "questions": (comparison.get("questions") or [])[:8],
                "summary": _clip(comparison.get("summary"), 800),
            },
            evidence=(
                f"{older_report.get('date')} vs {latest_report.get('date')}, "
                f"{len(changes)} test(s) compared"
            ),
            record_count=len(changes),
        )

    if name == "list_follow_ups":
        grouped = await client.upcoming_follow_ups(member_id, days=int(args.get("days") or 7))
        payload = {
            "summary": _clip(grouped.get("summary"), 400),
            "overdue": [_trim_follow_up(t) for t in (grouped.get("overdue") or [])],
            "dueToday": [_trim_follow_up(t) for t in (grouped.get("today") or [])],
            "dueThisWeek": [_trim_follow_up(t) for t in (grouped.get("thisWeek") or [])],
            "later": [_trim_follow_up(t) for t in (grouped.get("later") or [])],
        }
        total = sum(
            len(payload[key])
            for key in ("overdue", "dueToday", "dueThisWeek", "later")
        )
        return ToolResult(
            tool=name,
            source=SOURCE_LABELS[name],
            payload=payload,
            evidence=_clip(grouped.get("summary"), 200) or f"{total} outstanding task(s)",
            record_count=total,
        )

    if name == "get_daily_briefing":
        briefing = await client.briefing()
        payload = {
            "narrative": _clip(briefing.get("narrative"), 2500),
            "insights": [_clip(item, 400) for item in (briefing.get("insights") or [])[:12]],
            "questionsForTheDoctor": [
                _clip(item, 400)
                for item in (briefing.get("questionsForTheDoctor") or [])[:12]
            ],
        }
        return ToolResult(
            tool=name,
            source=SOURCE_LABELS[name],
            payload=payload,
            evidence="the daily briefing for the account",
            record_count=_count_records(briefing),
        )

    if name == "get_exercise_plan":
        plan = await client.exercise_plan(member_id)
        payload = {
            "targets": plan.get("targets"),
            "basis": [_clip(item, 400) for item in (plan.get("basis") or [])[:12]],
            "safetyNotes": [
                _clip(item, 400) for item in (plan.get("safetyNotes") or [])[:12]
            ],
            "intensityGuidance": _clip(plan.get("intensityGuidance"), 800),
        }
        targets = plan.get("targets") or {}
        target_text = ", ".join(f"{key}: {value}" for key, value in targets.items())
        return ToolResult(
            tool=name,
            source=SOURCE_LABELS[name],
            payload=payload,
            evidence="exercise plan targets"
            + (f" ({target_text})" if target_text else ""),
            record_count=1,
        )

    if name == "run_safety_check":
        incoming = args.get("medications") or []
        if not isinstance(incoming, list):
            incoming = []
        clean = [
            {"name": str(item.get("name") or ""), "dose": str(item.get("dose") or "")}
            for item in incoming
            if isinstance(item, dict) and item.get("name")
        ]
        check = await client.run_safety_check(member_id, clean)
        payload = {
            "highestSeverity": check.get("highestSeverity"),
            "findings": check.get("findings") or [],
            "notes": check.get("notes") or [],
            "message": check.get("message"),
        }
        findings = check.get("findings") or []
        return ToolResult(
            tool=name,
            source=SOURCE_LABELS[name],
            payload=payload,
            evidence=(
                f"safety check on {len(clean)} medication(s): "
                f"{check.get('highestSeverity') or 'clear'}"
            ),
            record_count=len(findings),
        )

    if name == "raise_health_alert":
        severity = str(args.get("severity") or "warning").lower()
        if severity == "critical":
            # A model must not be able to page a family with a critical alert
            # on its own judgement.
            severity = "warning"
            log.warning(
                "Downgraded a model-requested critical alert to warning for safety."
            )
        alert = await client.create_alert(
            member_id=member_id,
            alert_type=str(args.get("type") or "manual"),
            severity=severity if severity in ("info", "warning", "critical") else "warning",
            title=str(args.get("title") or "Health alert"),
            message=str(args.get("message") or ""),
        )
        created = bool(alert)
        payload = {
            "created": created,
            "alert": _trim_alert(alert) if alert else None,
        }
        return ToolResult(
            tool=name,
            source=SOURCE_LABELS[name],
            payload=payload,
            evidence=(
                "raised a health alert" if created else "could not raise the health alert"
            ),
            record_count=1 if created else 0,
        )

    log.warning("Unknown tool requested: %s", name)
    return ToolResult(
        tool=name,
        source="",
        payload={"error": f"Unknown tool '{name}'."},
        evidence="unknown tool",
        record_count=0,
    )


# -------------------------------------------------------------
# The ASI:One tool loop
# -------------------------------------------------------------


def _build_user_prompt(member: dict[str, Any] | None, question: str) -> str:
    """Add just enough context for the model to pick the right member."""
    if not member:
        return question
    name = str(member.get("name") or "the family member")
    relationship = str(member.get("relationship") or "")
    age = member.get("age")
    who = f"Family member: {name}"
    if relationship:
        who += f" ({relationship})"
    if age not in (None, "", 0):
        who += f", age {age}"

    # The member is already resolved from the question, so saying so
    # saves the model a round trip through list_family_members. Every
    # saved call is roughly 25 seconds on a full loop, and the caller
    # is usually on a timeout.
    return (
        f"{who}\n"
        f"(The family member is already resolved for you. Do not call "
        f"list_family_members unless the question is about a different person.)\n"
        f"\nQuestion: {question}"
    )


def _ensure_disclaimer(text: str) -> str:
    """Make sure the answer ends with the educational disclaimer."""
    cleaned = (text or "").strip()
    if not cleaned:
        cleaned = "I could not find anything in the records to answer that."
    if DISCLAIMER.lower() in cleaned.lower():
        return cleaned
    return f"{cleaned}\n\n{DISCLAIMER}"


async def run_tool_loop(
    client: HealthyfyClient,
    member: dict[str, Any] | None,
    question: str,
    history: list[dict[str, str]] | None = None,
    include_vitals: bool = True,
    include_adherence: bool = True,
    log: logging.Logger | None = None,
) -> AnswerResult:
    """Ask ASI:One a question, letting it call the Healthyfy tools it needs."""
    log = log or logger

    if not ASI1_API_KEY:
        log.warning("ASI1_API_KEY is not set; answering from the raw records instead.")
        return await fallback_answer(client, member, question, log)

    tools = build_tools(include_vitals=include_vitals, include_adherence=include_adherence)

    messages: list[dict[str, Any]] = [
        {"role": "system", "content": SYSTEM_INSTRUCTION}
    ]
    if history:
        messages.extend(history)
    messages.append({"role": "user", "content": _build_user_prompt(member, question)})

    results: list[ToolResult] = []
    openai_client = OpenAI(
        api_key=ASI1_API_KEY,
        base_url=ASI1_BASE_URL,
        # Fail fast. A caller waiting on an answer would rather get the
        # raw record summary in half a minute than wait three minutes
        # for a service that is down.
        timeout=float(_env("HEALTHYFY_MODEL_TIMEOUT", "45") or "45"),
        max_retries=int(_env("HEALTHYFY_MODEL_RETRIES", "1") or "1"),
    )

    for turn in range(MAX_TOOL_TURNS):
        # ASI:One is frequently briefly overloaded and says how long to
        # wait, so honour that before giving up on the model.
        response = None
        last_error: str | None = None
        for attempt in range(MODEL_MAX_ATTEMPTS):
            try:
                response = openai_client.chat.completions.create(
                    model=ASI1_MODEL,
                    messages=messages,
                    tools=tools,
                    tool_choice="auto",
                )
                break
            except Exception as exc:  # noqa: BLE001
                last_error = str(exc)
                wait = _retry_after_seconds(exc)
                if attempt == MODEL_MAX_ATTEMPTS - 1 or not _is_overloaded(exc):
                    break
                log.warning(
                    "ASI:One is overloaded, retrying in %ss (attempt %s)",
                    wait,
                    attempt + 2,
                )
                await asyncio.sleep(wait)

        if response is None:
            log.error("ASI:One request failed: %s", last_error)
            return await fallback_answer(client, member, question, log, error=last_error)

        message = response.choices[0].message
        tool_calls = getattr(message, "tool_calls", None)

        if not tool_calls:
            answer = _ensure_disclaimer(message.content or "")
            return AnswerResult(
                answer=answer,
                member=member,
                sources=_unique([result.source for result in results if result.source]),
                evidence=[result.evidence for result in results],
                records=sum(result.record_count for result in results),
                tool_calls=len(results),
            )

        messages.append(message.model_dump(exclude_none=True))

        for call in tool_calls:
            try:
                arguments = json.loads(call.function.arguments or "{}")
            except (TypeError, ValueError):
                arguments = {}
            if not isinstance(arguments, dict):
                arguments = {}

            result = await execute_tool(
                call.function.name, arguments, client, member, log
            )
            results.append(result)
            log.info(
                "Tool %s -> %s", call.function.name, result.evidence or "no data"
            )
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call.id,
                    "content": json.dumps(result.payload, ensure_ascii=False, default=str),
                }
            )

    log.warning("Tool loop hit the %s turn limit", MAX_TOOL_TURNS)
    return await fallback_answer(
        client, member, question, log, error="the tool loop ran out of turns"
    )


def _unique(values: list[str]) -> list[str]:
    """Order-preserving de-duplication."""
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value and value not in seen:
            seen.add(value)
            result.append(value)
    return result


async def fallback_answer(
    client: HealthyfyClient,
    member: dict[str, Any] | None,
    question: str,
    log: logging.Logger,
    error: str | None = None,
) -> AnswerResult:
    """Answer without ASI:One, straight from the Healthyfy records.

    Used when ASI:One is not configured or not reachable, so the agent
    still tells the family what is on record instead of failing.
    """
    member_id = str((member or {}).get("id") or "")
    name = str((member or {}).get("name") or "the family member")

    reports = await client.medical_reports(member_id)
    medications = await client.medications(member_id)
    allergies = await client.allergies(member_id)
    alerts = await client.open_alerts(member_id)

    lines = [
        f"Here is what the Healthyfy records hold for {name}.",
        "",
        f"Medical reports: {len(reports)}.",
    ]
    for report in reports[:3]:
        lines.append(
            f"- {report.get('reportType')} ({report.get('date')}): "
            f"{_clip(report.get('summary'), 260)}"
        )

    lines.append("")
    lines.append(f"Medications: {len(medications)}.")
    for medication in medications[:8]:
        lines.append(
            f"- {medication.get('name')} {medication.get('dose') or ''} "
            f"({medication.get('frequency') or 'as directed'})"
        )

    lines.append("")
    lines.append(f"Allergies: {len(allergies)}.")
    for allergy in allergies[:6]:
        lines.append(
            f"- {allergy.get('substance')}"
            + (f" ({allergy.get('reaction')})" if allergy.get("reaction") else "")
        )

    lines.append("")
    lines.append(f"Unresolved health alerts: {len(alerts)}.")
    for alert in alerts[:5]:
        lines.append(f"- [{alert.get('severity')}] {alert.get('title')}")

    if error:
        # list.insert takes a single object, so the two preamble lines
        # are spliced in as a list.
        lines[0:0] = [
            "ASI:One is not answering right now, so this is the raw record summary "
            f"rather than a written answer ({error}).",
            "",
        ]

    lines.append("")
    lines.append(f"Question asked: {question}")
    lines.append("")
    lines.append(DISCLAIMER)

    records = len(reports) + len(medications) + len(allergies) + len(alerts)
    sources = [
        SOURCE_LABELS["get_medical_reports"],
        SOURCE_LABELS["get_medications"],
        SOURCE_LABELS["get_allergies"],
        SOURCE_LABELS["get_open_alerts"],
    ]
    return AnswerResult(
        answer="\n".join(lines),
        member=member,
        sources=sources,
        evidence=[
            f"{len(reports)} medical report(s)",
            f"{len(medications)} medication(s)",
            f"{len(allergies)} allergy(ies)",
            f"{len(alerts)} unresolved alert(s)",
        ],
        records=records,
        tool_calls=0,
        error=error,
    )


# -------------------------------------------------------------
# Agent Chat Protocol (ACP)
# -------------------------------------------------------------

chat_proto = Protocol(spec=chat_protocol_spec)


@chat_proto.on_message(ChatAcknowledgement)
async def handle_acknowledgement(
    ctx: Context, sender: str, msg: ChatAcknowledgement
) -> None:
    """Absorb acknowledgements.

    The chat protocol specification declares both ``ChatMessage`` and
    ``ChatAcknowledgement``, and a protocol is only published once it
    implements every interaction in its specification, so this handler
    has to exist even though nothing needs doing with it.
    """
    ctx.logger.debug("Acknowledged %s", msg.msg_id)


@chat_proto.on_message(ChatMessage)
async def handle_chat(ctx: Context, sender: str, msg: ChatMessage) -> None:
    """Answer an ACP chat message from ASI:One Chat or any other ACP client."""
    await ctx.send(
        sender,
        ChatAcknowledgement(acknowledged_msg_id=msg.msg_id),
    )
    question = (msg.text() or "").strip()
    if not question:
        await ctx.send(
            sender,
            ChatMessage(
                content=[
                    TextContent(
                        text=(
                            "Ask me about any family member's medical reports, "
                            "medications, allergies, adherence or vitals."
                        )
                    )
                ]
            ),
        )
        return

    client = get_client()
    members = await client.family_members()
    member = resolve_member(members, question, DEFAULT_MEMBER)
    if member is None:
        await ctx.send(
            sender,
            ChatMessage(
                content=[
                    TextContent(
                        text=(
                            "I could not read the Healthyfy family list, so I cannot answer "
                            "that yet. Make sure the Healthyfy backend is running and the "
                            "credentials in the environment are correct."
                        )
                    )
                ]
            ),
        )
        return

    history = build_llm_message_history(ctx) or []
    if (
        history
        and history[-1].get("role") == "user"
        and (history[-1].get("content") or "").strip() == question
    ):
        # The current turn is already the last user message in the history.
        history = history[:-1]

    ctx.logger.info(
        "ACP question for %s: %s", member.get("name"), question[:120]
    )

    result = await run_tool_loop(
        client,
        member,
        question,
        history=history,
        include_vitals=True,
        include_adherence=True,
        log=ctx.logger,
    )

    sources = ", ".join(result.sources) if result.sources else "no records"
    header = (
        f"Read {result.records} Healthyfy record(s) for "
        f"{member.get('name')} ({sources})."
    )

    await ctx.send(
        sender,
        ChatMessage(content=[TextContent(text=f"{header}\n\n{result.answer}")]),
    )


# -------------------------------------------------------------
# Domain protocol handler (other agents calling this agent as a tool)
# -------------------------------------------------------------


async def answer_health_request(
    ctx: Context, sender: str, msg: HealthRequest
) -> None:
    """Answer a ``HealthRequest`` with a structured ``HealthResponse``."""
    client = get_client()
    members = await client.family_members()

    member: dict[str, Any] | None = None
    if msg.member_id:
        member = next(
            (m for m in members if str(m.get("id")) == str(msg.member_id)), None
        )
    if member is None:
        member = resolve_member(members, msg.question, DEFAULT_MEMBER)

    if member is None:
        await ctx.send(
            sender,
            HealthResponse(
                answer=(
                    "I could not read the Healthyfy family list, so there are no records to "
                    "answer from. Make sure the Healthyfy backend is running."
                ),
                member_name="unknown",
                evidence="no records",
                open_alerts=0,
                data_sources=[],
                disclaimer=DISCLAIMER,
            ),
        )
        return

    ctx.logger.info(
        "Health request for %s: %s", member.get("name"), msg.question[:120]
    )

    result = await run_tool_loop(
        client,
        member,
        msg.question,
        history=None,
        include_vitals=bool(msg.include_vitals),
        include_adherence=bool(msg.include_adherence),
        log=ctx.logger,
    )

    alerts = await client.open_alerts(str(member.get("id") or ""))
    sources = _unique(
        result.sources + [SOURCE_LABELS["get_open_alerts"]]
    )
    evidence_parts = list(result.evidence)
    if result.records:
        evidence_parts.append(
            f"{result.records} record(s) read for {member.get('name')}"
        )

    await ctx.send(
        sender,
        HealthResponse(
            answer=result.answer,
            member_name=str(member.get("name") or "unknown"),
            evidence="; ".join(evidence_parts) if evidence_parts else "no records",
            open_alerts=len(alerts),
            data_sources=sources,
            disclaimer=DISCLAIMER,
        ),
    )


# -------------------------------------------------------------
# Local REST endpoints (handy for local testing)
# -------------------------------------------------------------


class AskRequest(Model):
    """Body of the local ``POST /ask`` endpoint."""

    question: str = Field(..., description="The health question to ask.")
    member_id: str = Field(
        "", description="Family member id. Empty means the default member."
    )


class AskResponse(Model):
    """Body of the local ``POST /ask`` response."""

    answer: str = Field(..., description="The answer in plain language.")
    member_name: str = Field(..., description="Which family member it is about.")
    records: int = Field(..., description="How many records were consulted.")
    data_sources: list[str] = Field(..., description="Which endpoints were consulted.")
    disclaimer: str = Field(..., description="The educational disclaimer.")


class HealthStatus(Model):
    """Body of the local ``GET /health`` endpoint."""

    status: str = Field(..., description="Always 'ok' when the agent is up.")
    name: str = Field(..., description="The agent name.")
    address: str = Field(..., description="The agent address on Agentverse.")
    asi1_configured: bool = Field(..., description="Whether ASI:One is configured.")
    healthyfy_base_url: str = Field(..., description="The Healthyfy backend URL.")
    mailbox: bool = Field(..., description="Whether the agent uses an Agentverse mailbox.")
    default_member: str = Field(..., description="The configured default member.")


# -------------------------------------------------------------
# Agent wiring
# -------------------------------------------------------------

# A mailbox is what makes the agent reachable from Agentverse and from
# ASI:One. The uAgents library authenticates to the mailbox with a
# signed attestation derived from the agent's own key, so no user token
# is needed here: the mailbox is created for this address from the
# Agentverse inspector, and the library then polls it.
#
# AGENTVERSE_TOKEN is still accepted, because the "Launch an Agent ->
# External Integration -> uAgents" registration path and the Agentverse
# CLI both want one.
agent = Agent(
    name=AGENT_NAME,
    seed=AGENT_SEED or None,
    port=AGENT_PORT,
    mailbox=True,
    # The chat protocol keeps the conversation, and `ctx.session_history()`
    # raises unless the agent stores it. Without this the agent cannot
    # read the thread and the reply fails.
    store_message_history=True,
    # The profile is what ASI:One's planner reads to decide whether this
    # agent is the right one to call. Without a description and a README
    # the agent registers with empty metadata, gets found, and is then
    # passed over in favour of the model answering from its own knowledge.
    description=AGENT_DESCRIPTION,
    readme_path=PROFILE_README,
    handle=AGENT_HANDLE,
    publish_agent_details=True,
)

health_proto = HealthProtocol()

# `publish_manifest=True` publishes the protocol manifest to the Almanac,
# which is what makes the agent discoverable on Agentverse.
agent.include(health_proto, publish_manifest=True)
agent.include(chat_proto, publish_manifest=True)


def _startup_decorator(target: Agent):
    """Return the startup-hook decorator for this uAgents version."""
    if hasattr(target, "on_startup"):
        return target.on_startup
    return target.on_event("startup")


@_startup_decorator(agent)
async def on_startup(ctx: Context) -> None:
    """Log the agent address and how it is configured."""
    ctx.logger.info("Healthyfy agent %s", agent.name)
    ctx.logger.info("Agent address: %s", agent.address)
    ctx.logger.info("ASI:One: %s", ASI1_BASE_URL if ASI1_API_KEY else "not configured")
    ctx.logger.info("Healthyfy backend: %s", HEALTHYFY_BASE_URL)
    ctx.logger.info(
        "Mailbox client: %s",
        "running" if agent.mailbox_client is not None else "not running",
    )
    ctx.logger.info(
        "If the log says 'Agent mailbox not found', open the inspector URL above and "
        "click Connect -> Mailbox to create it."
    )
    ctx.logger.info("Default member: %s", DEFAULT_MEMBER or "first on the account")


@agent.on_rest_get("/health", HealthStatus)
async def rest_health(ctx: Context) -> HealthStatus:
    """Report how the agent is configured."""
    return HealthStatus(
        status="ok",
        name=agent.name,
        address=agent.address,
        asi1_configured=bool(ASI1_API_KEY),
        healthyfy_base_url=HEALTHYFY_BASE_URL,
        mailbox=agent.mailbox_client is not None,
        default_member=DEFAULT_MEMBER,
    )


@agent.on_rest_post("/ask", AskRequest, AskResponse)
async def rest_ask(ctx: Context, request: AskRequest) -> AskResponse:
    """Ask a question over plain HTTP, without the Agentverse network."""
    client = get_client()
    members = await client.family_members()
    member = None
    if request.member_id:
        member = next(
            (m for m in members if str(m.get("id")) == str(request.member_id)), None
        )
    if member is None:
        member = resolve_member(members, request.question, DEFAULT_MEMBER)
    if member is None:
        return AskResponse(
            answer=(
                "I could not read the Healthyfy family list. Is the backend running on "
                f"{HEALTHYFY_BASE_URL}?"
            ),
            member_name="unknown",
            records=0,
            data_sources=[],
            disclaimer=DISCLAIMER,
        )

    result = await run_tool_loop(
        client, member, request.question, log=ctx.logger
    )
    return AskResponse(
        answer=result.answer,
        member_name=str(member.get("name") or "unknown"),
        records=result.records,
        data_sources=result.sources,
        disclaimer=DISCLAIMER,
    )


if __name__ == "__main__":
    agent.run()
