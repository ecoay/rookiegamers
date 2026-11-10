import { test } from "node:test";
import assert from "node:assert/strict";
import { castErrors, drawParty, normalizeHandle, parsePartyRoom, partyRoom, reveal, sharePost } from "./party.ts";
import { SCENARIOS } from "./scenarios.ts";
import { cardSvg, wrap } from "./card.ts";

const cast = ["ecoay", "Whitney", "friend_3", "Friend4", "f5"];

test("every scenario has five distinct roles with two lines each", () => {
  assert.equal(SCENARIOS.length, 10);
  for (const s of SCENARIOS) {
    assert.equal(s.roles.length, 5, s.id);
    assert.equal(new Set(s.roles.map((r) => r.name)).size, 5, s.id);
    for (const r of s.roles) for (const line of r.lines) assert.ok(line.length <= 70, `${s.id}: ${line}`);
  }
});

test("handles: @ and case are normalised, duplicates and junk rejected", () => {
  assert.equal(normalizeHandle("  @@Bruce_Y "), "Bruce_Y");
  assert.equal(normalizeHandle("not a handle"), null);
  assert.equal(normalizeHandle("sixteen_chars_xx"), null);
  const errs = castErrors(["a", "@A", "", "b c", "ok"]);
  assert.equal(errs[0], null);
  assert.match(errs[1] ?? "", /slot 1/);
  assert.ok(errs[2] && errs[3]);
  assert.equal(errs[4], null);
});

test("a party room round-trips and always reveals the same joke", () => {
  const party = drawParty(cast, "ecoay", "dragon");
  const back = parsePartyRoom(partyRoom(party));
  assert.deepEqual(back, party);
  assert.deepEqual(parsePartyRoom(partyRoom({ ...party, assembler: null })), { ...party, assembler: null });
  const longest = { ...party, scenarioId: "timemachine", seed: "abcdef", cast: ["a".repeat(15), "b".repeat(15), "c".repeat(15), "d".repeat(15), "e".repeat(15)], assembler: "f".repeat(15) };
  assert.ok(partyRoom(longest).length <= 120, "fits a RookieGamers room");
  assert.deepEqual(parsePartyRoom(partyRoom(longest)), longest);
  const a = reveal(party)!;
  const b = reveal(back!)!;
  assert.deepEqual(a.members, b.members);
  assert.equal(new Set(a.members.map((m) => m.role)).size, 5, "five unique roles");
  assert.deepEqual(a.members.map((m) => m.handle).sort(), [...cast].sort(), "exactly the five, no sixth player");
});

test("different seeds deal different casts", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 30; i++) seen.add(reveal(drawParty(cast, null, "heist"))!.members.map((m) => m.role).join("|"));
  assert.ok(seen.size > 10);
});

test("the line-up order is shuffled per party", () => {
  const firsts = new Set<string>();
  for (let i = 0; i < 30; i++) firsts.add(reveal(drawParty(cast, null, "heist"))!.members[0].handle);
  assert.ok(firsts.size >= 3);
});

test("bad links don't reveal", () => {
  assert.equal(parsePartyRoom("dragon-1-abcd-a-b-c-d"), null);
  assert.equal(parsePartyRoom("dragon-1-abcd-a-b-c-d-a"), null, "duplicate handle");
  assert.equal(parsePartyRoom("dragon-1-abcd-a-b-c-d-e-by"), null);
  assert.equal(parsePartyRoom(null), null);
  assert.equal(reveal({ scenarioId: "nope", version: 1, seed: "abcd", cast, assembler: null }), null);
});

test("share post mentions all five in the text", () => {
  const r = reveal(drawParty(cast, null, "motel"))!;
  const post = sharePost(r);
  for (const h of cast) assert.ok(post.includes(`@${h}`));
});

test("card escapes text and wraps long lines", () => {
  const r = reveal(drawParty(["a", "b", "c", "d", "e"], "x", "heist"))!;
  const svg = cardSvg(r);
  assert.ok(!svg.includes('"get in."'), "quotes are escaped");
  assert.ok(svg.includes("Scenario by @ecoay"));
  assert.deepEqual(wrap("one two three four", 9, 1), ["one two…"]);
});

test("YouCult cutout: same handle, same cardboard on every card", async () => {
  const { cutoutSvg, handleSeed } = await import("./youcult-cutout.ts");
  const joint = { pivot: [128, 376], crown: [128, 42], eyes: [128, 86], brows: [128, 59], mouth: [128, 128], leftShoulder: [32, 164], rightShoulder: [225, 164] } as const;
  const joints = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [String(i + 1), joint])) as never;
  const kit = { href: (p: string) => `${p}.png`, joints, hats: { "5": { pivot: [96, 155] as [number, number] } } };
  assert.equal(cutoutSvg(kit, handleSeed("Whitney")), cutoutSvg(kit, handleSeed("whitney")));
  assert.notEqual(cutoutSvg(kit, handleSeed("Whitney")), cutoutSvg(kit, handleSeed("ecoay")));
  assert.equal(cutoutSvg({ ...kit, href: () => null }, "x"), null, "no art, no cutout: the card falls back");
  const r = reveal(drawParty(cast, null, "dragon"))!;
  assert.ok(cardSvg(r, kit).includes("chr_body_"));
});
