import { useEffect, useMemo, useState } from "react";
import { renderCard } from "./render.ts";
import { xAccountExists } from "./x-account.ts";
import { SCENARIOS } from "./game/scenarios.ts";
import {
  CAST_SIZE,
  castErrors,
  drawParty,
  normalizeHandle,
  parsePartyRoom,
  partyRoom,
  reveal,
  sharePost,
  type Party,
} from "./game/party.ts";

type Check = "idle" | "checking" | "ok" | "missing" | "unknown";

/** The card for a party, drawn in the browser. Null while it's drawing. */
function useCard(party: Party | null) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const r = party && reveal(party);
    if (!r) return;
    let live = true;
    let made: string | null = null;
    setUrl(null);
    setFailed(false);
    renderCard(r)
      .then((blob) => {
        made = URL.createObjectURL(blob);
        if (live) setUrl(made);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [party]);
  return { url, failed };
}

function CardImage({ party, alt }: { party: Party; alt: string }) {
  const { url, failed } = useCard(party);
  if (url) return <img className="card" src={url} alt={alt} />;
  return <div className="card pending">{failed ? "The card didn't draw. Try again." : "Drawing the disaster…"}</div>;
}

const SAMPLE: Party = {
  scenarioId: "dragon",
  version: 1,
  seed: "demo01",
  cast: ["ecoay", "YourFriend", "ThatGuy", "GroupChatMod", "TheLiability"],
  assembler: null,
};

/** A party a friend shared: it rides on the RookieGamers share link as the room. */
function sharedParty(): Party | null {
  return parsePartyRoom(window.rg?.invite.room());
}

export function App() {
  const [party, setParty] = useState<Party | null>(sharedParty);
  const [building, setBuilding] = useState(false);

  useEffect(() => window.rg?.game.loaded(), []);

  function show(next: Party) {
    window.rg?.game.gameplayStop();
    setParty(next);
    setBuilding(false);
    window.scrollTo(0, 0);
  }

  function home(build: boolean) {
    if (build) window.rg?.game.gameplayStart();
    setParty(null);
    setBuilding(build);
  }

  return (
    <div className="page">
      <header className="top">
        <button className="brand" onClick={() => home(false)}>
          FaultyParty
        </button>
        <span className="soon">Party vs Party · Coming Soon</span>
      </header>
      {party ? (
        <Result party={party} onAgain={(p) => show(p)} onNew={() => home(true)} />
      ) : building ? (
        <Builder onDone={show} />
      ) : (
        <Landing onStart={() => home(true)} />
      )}
      <footer className="foot">Free to play. Everyone starts as cardboard.</footer>
    </div>
  );
}

function Landing({ onStart }: { onStart: () => void }) {
  return (
    <main className="landing">
      <h1>Five friends. One terrible situation. Absolutely no qualifications.</h1>
      <p className="lede">Choose five friends. Give them a terrible situation. Find out which one makes it worse.</p>
      <button className="big" onClick={onStart}>
        Build Your Party
      </button>
      <CardImage party={SAMPLE} alt="An example FaultyParty card: five cardboard friends in The Dragon's Cavern" />
      <p className="small">
        {SCENARIOS.length} disasters so far. Custom characters are coming later as an optional upgrade. Cardboard is free forever.
      </p>
    </main>
  );
}

function Builder({ onDone }: { onDone: (p: Party) => void }) {
  const [me, setMe] = useState("");
  const [cast, setCast] = useState<string[]>(Array(CAST_SIZE).fill(""));
  const [checks, setChecks] = useState<Check[]>(Array(CAST_SIZE).fill("idle"));
  const [touched, setTouched] = useState<boolean[]>(Array(CAST_SIZE).fill(false));
  const [scenario, setScenario] = useState("");
  const errors = castErrors(cast);
  const meHandle = me.trim() ? normalizeHandle(me) : null;
  const meBad = me.trim() !== "" && !meHandle;
  const ready = errors.every((e) => !e) && checks.every((c) => c !== "missing" && c !== "checking") && !meBad;

  function setSlot(i: number, value: string) {
    setCast((prev) => prev.map((v, k) => (k === i ? value : v)));
    setChecks((prev) => prev.map((c, k) => (k === i ? "idle" : c)));
  }

  async function check(i: number) {
    setTouched((prev) => prev.map((t, k) => (k === i ? true : t)));
    const handle = normalizeHandle(cast[i]);
    if (!handle) return;
    setChecks((prev) => prev.map((c, k) => (k === i ? "checking" : c)));
    const found = await xAccountExists(handle);
    const status: Check = found === false ? "missing" : found === null ? "unknown" : "ok";
    // Use X's own capitalisation when we got it.
    if (found && found !== handle) setSlot(i, found);
    setChecks((prev) => prev.map((c, k) => (k === i ? status : c)));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(Array(CAST_SIZE).fill(true));
    if (!ready) return;
    const handles = cast.map((v) => normalizeHandle(v) as string);
    onDone(drawParty(handles, meHandle, scenario || undefined));
  }

  return (
    <main className="builder">
      <h2>Choose five friends</h2>
      <p className="small">Real X handles. You can be one of the five, but you don't have to be.</p>
      <form onSubmit={submit}>
        {cast.map((value, i) => {
          const err = touched[i] ? errors[i] : null;
          const status = checks[i];
          return (
            <label key={i} className="slot">
              <span className="num">{i + 1}</span>
              <span className="at">@</span>
              <input
                value={value}
                onChange={(e) => setSlot(i, e.target.value)}
                onBlur={() => check(i)}
                placeholder="handle"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
              <span className={`status ${err || status === "missing" ? "bad" : status}`}>
                {err ??
                  {
                    idle: "",
                    checking: "Checking…",
                    ok: "On X ✓",
                    missing: "No such account on X.",
                    unknown: "Couldn't check. We'll trust you.",
                  }[status]}
              </span>
            </label>
          );
        })}
        <label className="slot me">
          <span className="num">★</span>
          <span className="at">@</span>
          <input
            value={me}
            onChange={(e) => setMe(e.target.value)}
            placeholder="your handle (optional, for credit)"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <span className="status bad">{meBad ? "That isn't an X handle." : ""}</span>
        </label>
        <label className="pick">
          Disaster
          <select value={scenario} onChange={(e) => setScenario(e.target.value)}>
            <option value="">Surprise me</option>
            {SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
        <button className="big" type="submit" disabled={!ready}>
          Draw the situation
        </button>
      </form>
    </main>
  );
}

function Result({ party, onAgain, onNew }: { party: Party; onAgain: (p: Party) => void; onNew: () => void }) {
  const r = useMemo(() => reveal(party), [party]);
  const { url: img } = useCard(party);
  const [link, setLink] = useState<string | null>(null);
  const room = partyRoom(party);
  const post = r ? sharePost(r) : "";

  // Fetch the share link up front, so "Post it on X" can open straight from the tap.
  useEffect(() => {
    let live = true;
    setLink(null);
    window.rg?.invite.link({ room, text: post }).then((res) => live && res.ok && setLink(res.url));
    return () => {
      live = false;
    };
  }, [room, post]);

  if (!r) {
    return (
      <main className="result">
        <h2>That party fell apart.</h2>
        <p>That link doesn't point at a real party.</p>
        <button className="big" onClick={onNew}>
          Build Your Party
        </button>
      </main>
    );
  }
  const xIntent = `https://x.com/intent/tweet?text=${encodeURIComponent(post)}${link ? `&url=${encodeURIComponent(link)}` : ""}`;

  return (
    <main className="result">
      <h2>{r.scenario.title}</h2>
      <p className="setup">{r.scenario.setup}</p>
      <CardImage party={party} alt={`${r.scenario.title} party card`} />
      <div className="actions">
        <a className="big" href={xIntent} target="_blank" rel="noreferrer">
          Post it on X
        </a>
        <button onClick={() => window.rg?.share({ text: post, room })}>Share</button>
        {img && (
          <a href={img} download={`faultyparty-${r.scenario.id}-${party.seed}.png`}>
            Save card
          </a>
        )}
        <button onClick={() => onAgain(drawParty(party.cast, party.assembler))}>Same five, new disaster</button>
        <button onClick={onNew}>New party</button>
      </div>
      <p className="small">Saving doesn't work inside every frame. Long-press or right-click the card to save it.</p>
      <section className="upgrade">
        <h3>Still an NPC?</h3>
        <p>
          Everyone starts as cardboard. Become a main character and bring your face to the whole mess. It only changes how you
          look. You can still be the reason everyone dies.
        </p>
        <div className="offers">
          <button disabled>Draw Me · $7.99</button>
          <button disabled>Draw My Whole Party · $39.95</button>
        </div>
        <p className="small">Custom characters are coming soon. Cardboard stays free forever.</p>
      </section>
      <ol className="cast">
        {r.members.map((m) => (
          <li key={m.handle}>
            <a href={`https://x.com/${m.handle}`} target="_blank" rel="noreferrer">
              @{m.handle}
            </a>
            <strong>{m.role}</strong>
            <span>{m.line}</span>
          </li>
        ))}
      </ol>
      <p className="small">
        Scenario by @{r.scenario.creator}
        {party.assembler ? ` · Party assembled by @${party.assembler}` : ""}
      </p>
    </main>
  );
}
