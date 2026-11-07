import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMessages, complete, converse, gossipPrompt, systemPrompt } from "../web/llm.js";

test("consistent royal voice examples guide chat and gossip without overriding mixed or singular voices", () => {
  for (const examples of [
    ["We are pleased.", "You have Our thanks."],
    ["I am pleased.", "You have my thanks."],
    ["We are all here.", "I am pleased."],
    ["We are all here.", "Hello."],
    [],
  ]) {
    const scene = { voice: { examples } };
    const character = { name: "Test character" };
    const prompts = [
      systemPrompt({ character, gameTitle: "Test", scene }),
      gossipPrompt({ character, other: { name: "Alice" }, place: "Shrine", gameTitle: "Test", scene }),
    ];
    const royal = examples[1] === "You have Our thanks.";
    for (const prompt of prompts) {
      assert.equal(prompt.includes("consistently use royal self-reference"), royal);
      if (royal) {
        assert.match(prompt, /Never switch to "I", "I'm"/);
        assert.match(prompt, /Before calling say or tell, check every sentence/);
      }
    }
  }
});

test("strict chat templates receive one system message with all context and intact tool rounds", async () => {
  const originalFetch = globalThis.fetch;
  const sent: Record<string, unknown>[] = [];
  const responses = [
    { content: null, tool_calls: [{ id: "lookup", type: "function",
      function: { name: "get_character_info", arguments: '{"character":"Alice"}' } }] },
    { content: "DONE" },
    { content: "Hello!" },
    { content: "A memory." },
  ];
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/llm");
    const { payload } = JSON.parse(String(init?.body));
    sent.push(payload);
    assert.equal(payload.messages[0].role, "system");
    assert.equal(payload.messages.filter((message: { role: string }) => message.role === "system").length, 1);
    assert.equal(payload.messages[1].role, "user");
    return new Response(JSON.stringify({ ok: true, status: 200, statusText: "OK",
      text: JSON.stringify({ choices: [{ message: responses.shift() }] }) }));
  };
  try {
    const messages = buildMessages({ system: "Character rules", context: "Interaction history",
      scene: { me: { name: "Alice" } }, message: "Hello!", player: "Player" });
    const before = structuredClone(messages);
    const llm = { provider: "local", endpoint: "http://localhost:1234/v1", model: "strict-model", tools: true };
    const log: { sent: unknown }[] = [];
    const result = await converse({ llm, messages, log, runTool: async () => ({ name: "Alice" }) });
    assert.equal(result.tools.length, 1);
    const first = sent[0]!.messages as { role: string; content: string }[];
    assert.deepEqual(first.map((message) => message.role), ["system", "user"]);
    assert.match(first[0]!.content, /^Character rules\n\nInteraction history\n\nCurrent scene/);
    assert.match(first[0]!.content, /Alice/);
    assert.equal(first[1]!.content, "Player: Hello!");
    const followup = sent[1]!.messages as { role: string; tool_call_id?: string; tool_calls?: { id: string }[] }[];
    assert.deepEqual(followup.map((message) => message.role), ["system", "user", "assistant", "tool"]);
    assert.equal(followup[2]!.tool_calls![0]!.id, "lookup");
    assert.equal(followup[3]!.tool_call_id, "lookup");
    assert.deepEqual(log.map((entry) => entry.sent), sent, "debug log shows the actual normalized requests");
    assert.deepEqual(messages, before, "normalization does not mutate callers' messages");
    assert.equal((await converse({ llm: { ...llm, tools: false }, messages, log })).content, "Hello!");
    const memory = [{ role: "system", content: "Memory rules" }, { role: "user", content: "Events" }];
    assert.equal(await complete({ llm, messages: memory, log }), "A memory.");
    assert.deepEqual(sent[3]!.messages, memory, "already valid conversations remain unchanged");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
