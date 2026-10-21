"""Async HTTP client for the Healthyfy REST API.

The agent never reaches into the Healthyfy database. Everything it
knows about a family arrives through the same REST endpoints the web
app uses, so what the language model sees is exactly what the family
sees on screen.

Every method is defensive: a failed login, a 404 or a backend that is
simply not running returns ``None`` or an empty list and logs the
reason. A health agent that crashes because one endpoint hiccupped is
worse than one that answers with slightly less detail.
"""

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger("healthyfy.client")

DEFAULT_BASE_URL = "http://localhost:3000"
DEFAULT_EMAIL = "kartik@healthyfy.ai"
DEFAULT_PASSWORD = "healthyfy123"


class HealthyfyClient:
    """Thin async wrapper around the Healthyfy REST API."""

    def __init__(
        self,
        base_url: str | None = None,
        email: str | None = None,
        password: str | None = None,
        timeout: float = 20.0,
    ) -> None:
        self.base_url = (
            base_url or os.getenv("HEALTHYFY_BASE_URL") or DEFAULT_BASE_URL
        ).rstrip("/")
        self.email = email or os.getenv("HEALTHYFY_EMAIL") or DEFAULT_EMAIL
        self.password = password or os.getenv("HEALTHYFY_PASSWORD") or DEFAULT_PASSWORD
        self.timeout = timeout
        self._token: str | None = None
        self._client = httpx.AsyncClient(timeout=timeout)

    # -------------------------------------------------------------
    # Plumbing
    # -------------------------------------------------------------

    async def aclose(self) -> None:
        """Close the underlying HTTP connection pool."""
        await self._client.aclose()

    async def login(self) -> str | None:
        """Authenticate against Healthyfy and cache the bearer token."""
        try:
            response = await self._client.post(
                f"{self.base_url}/api/auth/login",
                json={"email": self.email, "password": self.password},
            )
        except Exception as exc:  # noqa: BLE001 - never let the agent die
            logger.error("Healthyfy login failed: %s", exc)
            return None

        if response.status_code != 200:
            logger.error(
                "Healthyfy login rejected with %s: %s",
                response.status_code,
                response.text[:200],
            )
            return None

        try:
            token = response.json().get("token")
        except Exception:  # noqa: BLE001
            logger.error("Healthyfy login returned a body that is not JSON")
            return None

        if not token:
            logger.error("Healthyfy login response did not contain a token")
            return None

        self._token = token
        logger.info("Logged in to Healthyfy at %s", self.base_url)
        return token

    async def _request(
        self,
        method: str,
        path: str,
        params: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
        retry_auth: bool = True,
    ) -> Any:
        """Perform an authenticated request, retrying once after a 401."""
        if not self._token:
            await self.login()
        if not self._token:
            logger.error("Skipping %s %s: not authenticated", method, path)
            return None

        try:
            response = await self._client.request(
                method,
                f"{self.base_url}{path}",
                headers={"Authorization": f"Bearer {self._token}"},
                params=params,
                json=body,
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("Healthyfy %s %s failed: %s", method, path, exc)
            return None

        if response.status_code == 401 and retry_auth:
            logger.info("Healthyfy token expired, re-authenticating")
            self._token = None
            await self.login()
            return await self._request(
                method, path, params=params, body=body, retry_auth=False
            )

        if response.status_code >= 400:
            logger.error(
                "Healthyfy %s %s returned %s: %s",
                method,
                path,
                response.status_code,
                response.text[:300],
            )
            return None

        try:
            return response.json()
        except Exception:  # noqa: BLE001
            logger.error("Healthyfy %s %s returned a body that is not JSON", method, path)
            return None

    # -------------------------------------------------------------
    # Family
    # -------------------------------------------------------------

    async def family_members(self) -> list[dict[str, Any]]:
        """All family members on the Healthyfy account."""
        data = await self._request("GET", "/api/family")
        return data if isinstance(data, list) else []

    async def member_by_id(self, member_id: str) -> dict[str, Any] | None:
        """One family member by id, or ``None`` when it is not on this account."""
        members = await self.family_members()
        for member in members:
            if member.get("id") == member_id:
                return member
        return None

    # -------------------------------------------------------------
    # Clinical records
    # -------------------------------------------------------------

    async def medical_reports(self, member_id: str) -> list[dict[str, Any]]:
        """Medical reports (lab panels, summaries) for one member."""
        data = await self._request("GET", "/api/records", params={"memberId": member_id})
        return data if isinstance(data, list) else []

    async def medications(self, member_id: str) -> list[dict[str, Any]]:
        """The medication list for one member."""
        data = await self._request(
            "GET", "/api/medications", params={"memberId": member_id}
        )
        return data if isinstance(data, list) else []

    async def allergies(self, member_id: str) -> list[dict[str, Any]]:
        """Recorded allergies for one member."""
        data = await self._request(
            "GET", "/api/allergies", params={"memberId": member_id}
        )
        return data if isinstance(data, list) else []

    async def adherence(
        self, member_id: str, days: int = 14
    ) -> dict[str, Any]:
        """Medication adherence log plus its summary."""
        data = await self._request(
            "GET",
            "/api/adherence",
            params={"memberId": member_id, "days": days},
        )
        if isinstance(data, dict):
            return data
        return {"entries": [], "summary": {}}

    async def vitals(
        self,
        member_id: str,
        vital_type: str | None = None,
        hours: int = 24,
    ) -> list[dict[str, Any]]:
        """Recent vital readings for one member."""
        params: dict[str, Any] = {"memberId": member_id, "hours": hours}
        if vital_type:
            params["type"] = vital_type
        data = await self._request("GET", "/api/vitals", params=params)
        return data if isinstance(data, list) else []

    async def alerts(self, member_id: str) -> list[dict[str, Any]]:
        """Every health alert raised for one member."""
        data = await self._request("GET", "/api/alerts", params={"memberId": member_id})
        return data if isinstance(data, list) else []

    async def open_alerts(self, member_id: str) -> list[dict[str, Any]]:
        """Alerts that are still unresolved."""
        return [
            alert
            for alert in await self.alerts(member_id)
            if alert.get("status") not in ("resolved", "cancelled")
        ]

    async def briefing(self) -> dict[str, Any]:
        """The daily briefing for the whole account."""
        data = await self._request("GET", "/api/briefing")
        return data if isinstance(data, dict) else {}

    async def exercise_plan(self, member_id: str) -> dict[str, Any]:
        """The exercise plan generated for one member."""
        data = await self._request(
            "GET", "/api/exercise-plan", params={"memberId": member_id}
        )
        return data if isinstance(data, dict) else {}

    async def compare_reports(
        self,
        member_id: str,
        older_id: str = "",
        latest_id: str = "",
    ) -> dict[str, Any]:
        """Compare two stored reports and return the value changes."""
        params: dict[str, Any] = {"memberId": member_id}
        if older_id:
            params["olderId"] = older_id
        if latest_id:
            params["latestId"] = latest_id
        data = await self._request("GET", "/api/records/compare", params=params)
        return data if isinstance(data, dict) else {}

    async def follow_ups(self, member_id: str = "") -> list[dict[str, Any]]:
        """The follow-up tasks stored for a member."""
        params: dict[str, Any] = {}
        if member_id:
            params["memberId"] = member_id
        data = await self._request("GET", "/api/follow-up", params=params)
        return data if isinstance(data, list) else []

    async def upcoming_follow_ups(
        self, member_id: str = "", days: int = 7
    ) -> dict[str, Any]:
        """The follow-up tasks grouped by when they are due."""
        params: dict[str, Any] = {"days": days}
        if member_id:
            params["memberId"] = member_id
        data = await self._request("GET", "/api/follow-up/upcoming", params=params)
        return data if isinstance(data, dict) else {}

    # -------------------------------------------------------------
    # Actions
    # -------------------------------------------------------------

    async def run_safety_check(
        self, member_id: str, medications: list[dict[str, Any]]
    ) -> dict[str, Any]:
        """Run the allergy / interaction safety check for a medication list."""
        data = await self._request(
            "POST",
            "/api/safety/check",
            body={"memberId": member_id, "medications": medications},
        )
        if isinstance(data, dict):
            return data
        return {}

    async def create_alert(
        self,
        member_id: str,
        alert_type: str,
        severity: str,
        title: str,
        message: str,
    ) -> dict[str, Any] | None:
        """Raise a health alert for a member."""
        data = await self._request(
            "POST",
            "/api/alerts",
            body={
                "memberId": member_id,
                "type": alert_type,
                "severity": severity,
                "title": title,
                "message": message,
            },
        )
        return data if isinstance(data, dict) else None
