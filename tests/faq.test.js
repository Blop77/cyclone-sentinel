// Run with:  npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const F = require("../js/faq.js");

const entries = F.parseFaq(fs.readFileSync(path.join(__dirname, "../docs/FAQ.md"), "utf8"));
const top = (q) => (F.search(q, entries)[0] || {}).q;

test("FAQ parses into question/answer entries", () => {
  assert.ok(entries.length >= 25, `${entries.length} entries`);
  for (const e of entries) {
    assert.match(e.q, /\?$/, `heading is a question: ${e.q}`);
    assert.ok(e.a.length > 40, `answer for "${e.q}" is not empty`);
  }
});

test("judges' phrasings find the right FAQ entry", () => {
  const cases = {
    "How accurate is your model?": "How accurate is it? How was it validated?",
    "can the AI hallucinate": "Can the AI make mistakes? How do you stop hallucinations reaching officials?",
    "Is the infrastructure data real or fake?": "Is the infrastructure data real?",
    "what is GEE": "How is Google Earth Engine used?",
    "How will this scale to other countries?": "How does it scale to other states or countries?",
    "what is the price": "What would it cost to run?",
    "how are alerts sent to officials": "How are warnings sent?",
    "who will use this": "Who would use it?",
    "how do you prioritise": "How do you decide what is most critical?",
    "is the api key safe": "Where is the Gemini API key? Is it safe?",
    "what is your website": "Where can I see the demo, video and code?",
  };
  for (const [q, want] of Object.entries(cases)) assert.equal(top(q), want, q);
});

test("off-topic questions return nothing instead of a random answer", () => {
  assert.deepEqual(F.search("what is the weather today in paris", entries), []);
  assert.deepEqual(F.search("who is the prime minister", entries), []);
  assert.deepEqual(F.search("asdf qwerty", entries), []);
});

test("rendering escapes HTML and keeps simple Markdown", () => {
  const html = F.render("<script>x</script> **bold**\nwrapped line\n\n- one\n  continued\n- two [Docs](METHODOLOGY.md)");
  assert.ok(!html.includes("<script>"));
  assert.match(html, /<p>&lt;script&gt;x&lt;\/script&gt; <b>bold<\/b> wrapped line<\/p>/);
  assert.match(html, /<ul><li>one continued<\/li><li>two <a href="https:\/\/github.com\/Blop77\/cyclone-sentinel\/blob\/main\/docs\/METHODOLOGY.md"/);
});
