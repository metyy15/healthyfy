# Healthyfy Health Agent

A personal and family health agent that reads a family's **real** medical
records — lab reports and their values, medication lists, allergy history,
medication adherence, monitoring data and health alerts — and answers
questions about them.

## What it can do

- **Compare two lab reports** and report how each test value changed, with the
  reference range for every test. It will not compare two results that carry
  different units, and it lists the tests it refused to compare with the reason.
- **Check a medication list** against the recorded allergies, other
  medications and conditions, and report the findings by severity. It uses the
  FDA drug labels, so it covers any medicine, not a fixed list.
- **Read the medication adherence log** and connect missed doses to the lab
  trend, which is how a rising HbA1c gets explained.
- **List the outstanding follow-up tasks**, grouped by overdue, due today, due
  this week and later.
- **Summarise the daily briefing**, the open health alerts, the recorded
  vitals and the exercise plan.

## What it will not do

- It does not diagnose. It describes what the record says and prepares
  questions for a doctor.
- It never changes a medication schedule. A medication change is recorded as a
  question for the prescriber.
- It does not invent a lab value, a date or an instruction.
- It does not claim to have contacted anyone. It creates tasks and reminders
  for the person.

## How it works

A message arrives over the Agent Chat Protocol, or another agent calls the
`healthyfy-health` protocol. The agent runs an ASI:One tool loop: the model is
offered the Healthyfy API operations as tools, calls the ones it needs, and the
results are fed back until it produces an answer grounded in the record.

## Interface

- **Agent Chat Protocol** — so ASI:One Chat or any other agent can talk to it.
- **`healthyfy-health` protocol** — `HealthRequest` to `HealthResponse`, so other
  agents can call it as a structured tool.
