// Home page behaviour: search, category chips, play-type filter, the More menu and the wallet
// dialog. Everything filters the cards already on the page; nothing here talks to the server.
(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const aliases = (window.RG_HOME && window.RG_HOME.aliases) || {};
  const cards = $$('#grid .gc');
  const q = $('#q');
  const empty = $('#empty');
  const params = new URLSearchParams(location.search);
  const state = { q: '', cat: 'all', pt: null, fresh: params.get('sort') === 'new' };

  const tagsFor = cat => aliases[cat] || [cat];

  function apply() {
    const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    const want = state.cat === 'all' || state.cat === 'featured' ? null : tagsFor(state.cat);
    let shown = 0;
    for (const c of cards) {
      const tags = (c.dataset.tags || '').split('|');
      const ok = words.every(w => (c.dataset.q || '').includes(w))
        && (!want || want.some(t => tags.includes(t)))
        && (state.cat !== 'featured' || c.dataset.featured === '1')
        && (!state.pt || c.dataset.wallet === state.pt)
        && (!state.fresh || c.dataset.new === '1');
      c.hidden = !ok;
      if (ok) shown++;
    }
    if (empty) empty.hidden = shown > 0;
  }

  function setCat(cat) {
    state.cat = cat;
    for (const b of $$('[data-cat]')) {
      const on = b.dataset.cat === cat;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
    }
    apply();
  }

  function setPT(pt) {
    state.pt = state.pt === pt ? null : pt;
    for (const b of $$('[data-pt]')) b.setAttribute('aria-pressed', b.dataset.pt === state.pt);
    apply();
  }

  // Search, with ⌘K / Ctrl+K and "/" to jump to it.
  q?.addEventListener('input', () => { state.q = q.value.trim(); apply(); });
  q?.addEventListener('keydown', e => { if (e.key === 'Enter') $('#trending')?.scrollIntoView({ block: 'start' }); });
  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) { e.preventDefault(); q?.focus(); q?.select(); }
  });
  const kbd = $('.search kbd');
  if (kbd && !/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) kbd.textContent = 'Ctrl K';

  // Category chips, including the ones in the More menu.
  const moreBtn = $('#moreBtn'), moreList = $('#moreList');
  document.addEventListener('click', e => {
    const chip = e.target.closest('[data-cat]');
    if (chip) {
      setCat(chip.dataset.cat === state.cat && chip.dataset.cat !== 'all' ? 'all' : chip.dataset.cat);
      if (moreList && moreList.contains(chip)) closeMore();
      return;
    }
    if (moreList && !moreList.hidden && !e.target.closest('.more')) closeMore();
  });
  function closeMore() { moreList.hidden = true; moreBtn.setAttribute('aria-expanded', 'false'); }
  moreBtn?.addEventListener('click', () => {
    const open = moreList.hidden;
    moreList.hidden = !open;
    moreBtn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && moreList && !moreList.hidden) closeMore(); });

  // Play type: one at a time, click again to clear.
  for (const b of $$('[data-pt]')) b.addEventListener('click', () => setPT(b.dataset.pt));

  // See All Trending clears every filter.
  $('#seeAll')?.addEventListener('click', () => {
    state.q = ''; state.fresh = false; if (q) q.value = '';
    state.pt = null; for (const b of $$('[data-pt]')) b.setAttribute('aria-pressed', 'false');
    setCat('all');
  });

  // Explore Web3: show onchain games (wallet required, or optional if none require one).
  for (const a of $$('[data-goto="web3"]')) a.addEventListener('click', () => {
    const any = cards.some(c => c.dataset.wallet === 'required');
    state.pt = null;
    setPT(any ? 'required' : 'optional');
  });

  // Wallets aren't live yet: explain instead of pretending to connect.
  const dlg = $('#walletDlg');
  $('#walletBtn')?.addEventListener('click', () => (dlg?.showModal ? dlg.showModal() : alert(dlg?.querySelector('p')?.textContent)));
  $('#walletOk')?.addEventListener('click', () => dlg.close());
  dlg?.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });

  // Deep links from the rail: /?cat=multiplayer and /?sort=new.
  const cat = (params.get('cat') || '').toLowerCase();
  if (cat && $$('[data-cat]').some(b => b.dataset.cat === cat)) setCat(cat);
  else apply();
  if (cat || state.fresh) {
    for (const a of $$('.rail a')) {
      const h = a.getAttribute('href');
      const on = (state.fresh && h === '/?sort=new') || (cat && h === `/?cat=${cat}`);
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
    $('#trending')?.scrollIntoView({ block: 'start' });
  }
})();
