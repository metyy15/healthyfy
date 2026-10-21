"""Domain protocol for the Healthyfy health agent.

Two very different things live side by side in this service:

* the Agent Chat Protocol (ACP) implemented in ``agent.py`` so that
  ASI:One and Agentverse can talk to this agent like a chatbot, and
* this domain protocol, so that *other agents* can call this agent as
  a tool: they send a :class:`HealthRequest` and get a structured
  :class:`HealthResponse` back.

The models are plain ``uagents_core`` models, which means they are
also usable from any other Fetch.ai agent in any language that speaks
the Fetch.ai envelope protocol.
"""

from uagents import Context, Protocol
from uagents_core.models import Field, Model
from uagents_core.protocol import ProtocolSpecification

#: Version of the domain protocol. Bump this when the message shape changes.
PROTOCOL_VERSION = "0.1.0"

#: Name of the domain protocol, as published in the agent manifest.
PROTOCOL_NAME = "healthyfy-health"


class HealthRequest(Model):
    """A question about one family member's Healthyfy records."""

    user_email: str = Field(
        ...,
        description="Email of the Healthyfy account to read records for.",
    )
    member_id: str = Field(
        "",
        description="Family member id. Empty means use the default member.",
    )
    question: str = Field(
        ...,
        description="The health question to answer using the family records.",
    )
    include_vitals: bool = Field(
        ...,
        description="Include recent vitals (heart rate, steps) in the context.",
    )
    include_adherence: bool = Field(
        ...,
        description="Include the 14-day medication adherence log.",
    )


class HealthResponse(Model):
    """The structured answer returned to a calling agent."""

    answer: str = Field(
        ...,
        description="The answer in plain language.",
    )
    member_name: str = Field(
        ...,
        description="Which family member the answer is about.",
    )
    evidence: str = Field(
        ...,
        description="The records the answer was based on, as a short readable summary.",
    )
    open_alerts: int = Field(
        ...,
        description="How many unresolved health alerts the member has.",
    )
    data_sources: list[str] = Field(
        ...,
        description="Which Healthyfy endpoints were consulted.",
    )
    disclaimer: str = Field(
        ...,
        description="Educational-information disclaimer, not a diagnosis.",
    )


#: The interaction this protocol exposes. Declared here so the models are
#: documented in one place and the published manifest can be verified.
HEALTH_SPEC = ProtocolSpecification(
    name=PROTOCOL_NAME,
    version=PROTOCOL_VERSION,
    interactions={HealthRequest: {HealthResponse}},
)


class HealthProtocol(Protocol):
    """Domain protocol: lets other agents call this agent as a tool.

    The handler itself lives in ``agent.py`` because it needs the
    ASI:One tool loop and the Healthyfy HTTP client. The import is
    deferred to the moment a message arrives, which keeps this module
    free of a circular import.
    """

    def __init__(self) -> None:
        # NOTE: the protocol is created with an explicit name and version
        # rather than `spec=HEALTH_SPEC`. A protocol built from a locked
        # specification compares the `replies` argument against the
        # specification's internal reply map, and that comparison rejects
        # the equivalent set. Building it this way lets the `replies`
        # argument below populate the manifest identically.
        super().__init__(name=PROTOCOL_NAME, version=PROTOCOL_VERSION)
        proto = self

        @proto.on_message(HealthRequest, replies={HealthResponse})
        async def handle_health_request(
            ctx: Context, sender: str, msg: HealthRequest
        ) -> None:
            """Answer a ``HealthRequest`` with a ``HealthResponse``."""
            await proto.handle_request(ctx, sender, msg)

    async def handle_request(
        self, ctx: Context, sender: str, msg: HealthRequest
    ) -> None:
        """Delegate to the agent's answering engine.

        Imported lazily so that ``agent.py`` can import this module
        without the two modules importing each other at load time.
        """
        from agent import answer_health_request  # noqa: PLC0415 (deferred on purpose)

        await answer_health_request(ctx, sender, msg)
