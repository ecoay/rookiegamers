// The parts of the RookieGamers SDK (https://rookiegamers.com/sdk/v1.js) FaultyParty uses.
// Every call resolves; failures come back as { ok: false }.
type RgResult<T = object> = Promise<({ ok: true } & T) | { ok: false; error?: string }>;

interface Window {
  rg?: {
    init(o: { game: string; test?: boolean }): RgResult<{ mode: "portal" | "standalone" | "test" }>;
    game: { loaded(): void; gameplayStart(): void; gameplayStop(): void };
    share(o: { text?: string; room?: string; score?: number }): RgResult<{ url: string; shared: string | null }>;
    invite: { link(o: { room?: string; text?: string }): RgResult<{ url: string }>; room(): string | null };
  };
}
