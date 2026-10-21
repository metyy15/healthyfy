#!/usr/bin/env node
/**
 * A mock ASI:One endpoint for testing the uAgent's tool loop without a
 * real key. The first turn asks for a tool call, the second returns a
 * final answer.
 *
 *   node scripts/agent-mock.mjs [port]
 */
import { createServer } from 'http';

const PORT = Number(process.argv[2] || 4142);

const TOOL_SEQUENCE = ['get_medical_reports', 'get_adherence_log'];

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const payload = JSON.parse(body || '{}');
    const messages = payload.messages || [];
    const toolResults = messages.filter((m) => m.role === 'tool');

    const send = (message) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'mock-asi1',
          model: payload.model,
          choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
        })
      );
    };

    if (payload.tools?.length && toolResults.length < TOOL_SEQUENCE.length) {
      const name = TOOL_SEQUENCE[toolResults.length];
      const tool = payload.tools.find((t) => t.function?.name === name);
      const props = tool?.function?.parameters?.properties || {};
      const args = {};
      for (const key of Object.keys(props)) {
        args[key] = key === 'member_id' ? 'fam-2' : key === 'days' ? 14 : '';
      }
      return send({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: `call_${toolResults.length + 1}`,
            type: 'function',
            function: { name, arguments: JSON.stringify(args) },
          },
        ],
      });
    }

    send({
      role: 'assistant',
      content:
        'Rajesh Sharma’s HbA1c rose from 7.1% to 8.4% between February and September, and the adherence log shows the evening metformin was missed repeatedly over the same period. That is worth raising with his doctor. This is educational information, not a diagnosis.',
    });
  });
});

server.listen(PORT, () => console.log(`mock ASI:One on http://localhost:${PORT}/v1`));
