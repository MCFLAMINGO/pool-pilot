/* Pool Pilot partner seat — path, milestones, monthly pay */
(function () {
  'use strict';
  var L = window.ChainLib;
  var P = window.PoolPilotPartner;
  var CFG = L.CFG;
  var read = L.getProvider();
  var $ = function (id) { return document.getElementById(id); };

  var S = {
    wallet: { addr: null, provider: null, chainOk: false },
    round: null,
    board: null,
    ethUsd: null,
    busy: false,
    plan: null
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function short(a) {
    if (!a) return '—';
    return a.slice(0, 6) + '…' + a.slice(-4);
  }
  function fmtUsd(n) {
    if (n == null || !isFinite(n)) return '—';
    if (n < 10) return '$' + n.toFixed(2);
    return '$' + Math.round(n).toLocaleString();
  }
  function fmtVol(n) {
    if (n == null || !isFinite(n) || n <= 0) return '$0';
    if (n >= 1000000) return '$' + (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1) + 'M';
    if (n >= 1000) return '$' + (n / 1000).toFixed(n % 1000 === 0 ? 0 : 0) + 'k';
    return fmtUsd(n);
  }
  function apiBase() {
    return P && P.apiBase ? P.apiBase() : location.origin;
  }
  function showErr(msg) {
    var b = $('errBanner');
    if (!msg) {
      b.classList.add('hidden');
      b.textContent = '';
      return;
    }
    b.textContent = msg;
    b.classList.remove('hidden');
  }
  function explorerTx(h) { return CFG.EXPLORER + '/tx/' + h; }
  function explorerAddr(a) { return CFG.EXPLORER + '/address/' + a; }

  function discoverProviders() {
    var out = [];
    var seen = [];
    function add(provider, name) {
      if (!provider || typeof provider.request !== 'function' || seen.indexOf(provider) !== -1) return;
      seen.push(provider);
      out.push({ provider: provider, name: name || 'Wallet' });
    }
    // EIP-6963 (Rabby / MetaMask multi-wallet)
    eip6963Wallets.forEach(function (w) { add(w.provider, w.name); });
    var ethereum = window.ethereum;
    if (ethereum) {
      if (ethereum.providers && ethereum.providers.length) {
        ethereum.providers.forEach(function (p) {
          add(p, p.isRabby ? 'Rabby' : p.isMetaMask ? 'MetaMask' : 'Injected');
        });
      } else add(ethereum, ethereum.isRabby ? 'Rabby' : ethereum.isMetaMask ? 'MetaMask' : 'Injected');
    }
    // Prefer Rabby when several are injected
    out.sort(function (a, b) {
      var ar = /rabby/i.test(a.name) ? 0 : 1;
      var br = /rabby/i.test(b.name) ? 0 : 1;
      return ar - br;
    });
    return out;
  }

  var eip6963Wallets = [];
  window.addEventListener('eip6963:announceProvider', function (e) {
    var d = e && e.detail;
    if (!d || !d.provider) return;
    for (var i = 0; i < eip6963Wallets.length; i++) {
      if (eip6963Wallets[i].provider === d.provider) return;
    }
    eip6963Wallets.push({
      provider: d.provider,
      name: (d.info && d.info.name) || 'Wallet'
    });
  });
  try { window.dispatchEvent(new Event('eip6963:requestProvider')); } catch (e) { /* ignore */ }

  function bindProvider(raw, addr) {
    if (typeof ethers === 'undefined') {
      return Promise.reject(new Error('Wallet library failed to load — hard refresh the page.'));
    }
    var web3 = new ethers.providers.Web3Provider(raw, 'any');
    S.wallet = { addr: addr, provider: web3, chainOk: false };
    return web3.send('eth_chainId', []).then(function (id) {
      var ok = parseInt(id, 16) === CFG.CHAIN_ID;
      S.wallet.chainOk = ok;
      $('walletBtn').textContent = ok ? short(addr) : short(addr) + ' · switch';
      // Auto-bind seat ref from wallet so attribution works without pasting.
      return P.bindRefFromWallet(addr).then(function (ref) {
        if (ref && !$('ref').value) $('ref').value = ref;
        if (!ok) return ensureChain(raw);
      });
    }).then(function () {
      return loadBoard();
    });
  }

  function ensureChain(raw) {
    return raw.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: CFG.CHAIN_ID_HEX }]
    }).then(function () {
      S.wallet.chainOk = true;
      $('walletBtn').textContent = short(S.wallet.addr);
    }).catch(function (e) {
      if (e && (e.code === 4902 || /Unrecognized chain/i.test(String(e.message || e)))) {
        return raw.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: CFG.CHAIN_ID_HEX,
            chainName: 'Robinhood Chain',
            nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
            rpcUrls: [CFG.RPC],
            blockExplorerUrls: [CFG.EXPLORER]
          }]
        }).then(function () {
          S.wallet.chainOk = true;
          $('walletBtn').textContent = short(S.wallet.addr);
        });
      }
      throw e;
    });
  }

  function connect() {
    try { window.dispatchEvent(new Event('eip6963:requestProvider')); } catch (e) { /* ignore */ }
    if (typeof ethers === 'undefined') {
      showErr('Wallet library blocked — hard refresh (Cmd+Shift+R). If it keeps failing, try /swap Connect first.');
      return Promise.reject(new Error('ethers missing'));
    }
    var list = discoverProviders();
    if (!list.length) {
      showErr('No wallet found. Install MetaMask or Rabby, then refresh.');
      return Promise.reject(new Error('No wallet'));
    }
    var raw = list[0].provider;
    $('walletBtn').textContent = 'Connecting…';
    return raw.request({ method: 'eth_requestAccounts' }).then(function (accs) {
      if (!accs || !accs[0]) throw new Error('No account returned.');
      return bindProvider(raw, accs[0]);
    }).catch(function (e) {
      if (!S.wallet.addr) $('walletBtn').textContent = 'Connect';
      throw e;
    });
  }

  $('walletBtn').addEventListener('click', function () {
    if (S.wallet.addr) {
      S.wallet = { addr: null, provider: null, chainOk: false };
      $('walletBtn').textContent = 'Connect';
      showErr('');
      return;
    }
    connect().catch(function (e) { showErr((e && e.message) || String(e)); });
  });

  function renderPathLegend(board) {
    var legend = board.pathLegend || board.stages || [];
    if (!legend.length) {
      $('pathLegend').textContent = 'Milestones loading…';
      return;
    }
    $('pathLegend').innerHTML = legend.map(function (s) {
      return (
        '<div class="seat-path-item">' +
        '<div class="seat-path-vol">' + esc(fmtVol(s.volumeUsd)) + ' vol</div>' +
        '<div><div class="seat-path-name">' + esc(s.name) + '</div>' +
        '<div class="seat-path-blurb">' + esc(s.blurb || '') + '</div></div>' +
        '</div>'
      );
    }).join('');
    var note =
      (board.economics && board.economics.note) ||
      (board.incentivePool && board.incentivePool.note) ||
      'No partner cash from treasury. Desk 0.30% stays with Pool Pilot. You earn when your buy wall fills.';
    $('incentiveNote').textContent = note;
  }

  function renderRound(board) {
    S.round = board.round;
    S.board = board;
    var r = board.round;
    var price = r.seatPriceUsd != null ? r.seatPriceUsd : r.usdMin;
    $('roundKicker').textContent = 'Round ' + board.activeRound + ' · ' + r.maxSeats + ' seats';
    $('tierPrice').textContent = fmtUsd(price);
    $('tierName').textContent = r.name;
    $('seatsLeft').textContent = String(board.seatsLeft);
    $('seatsTaken').textContent = String(board.seatsTaken);
    $('seatsMax').textContent = String(r.maxSeats);
    var fill = r.maxSeats > 0 ? (board.seatsTaken / r.maxSeats) * 100 : 0;
    $('progressBar').style.width = Math.min(100, fill) + '%';
    if (board.activeRound === 1) {
      $('nextRoundLine').textContent =
        'Round 2 ($1k–$5k seats) opens when these ' + r.maxSeats + ' fill, raise hits ' +
        fmtUsd(r.advanceRaisedUsd) + ', or attributed volume clears ' +
        fmtUsd(board.advance && board.advance.needVolume) + '.';
    } else {
      $('nextRoundLine').textContent = 'Growth seats open. Same milestones — higher ticket.';
    }
    $('usd').value = String(price);
    $('usd').min = r.usdMin;
    $('usd').max = r.usdMax;
    if (r.usdMin === r.usdMax) $('usd').readOnly = true;
    else $('usd').readOnly = false;
    updateEthPreview();
    renderPathLegend(board);
  }

  function overallProgress(path, stages) {
    if (!path || !stages || !stages.length) return 0;
    var maxV = stages[stages.length - 1].volumeUsd || 1;
    return Math.min(1, (path.workUsd || 0) / maxV);
  }

  function renderBoard(board) {
    var rows = board.board || [];
    var stages = board.stages || [];
    var myRef = P.cleanRef($('ref').value) || P.getRef();
    var myWallet = (S.wallet.addr || '').toLowerCase();
    var meta = $('boardMeta');
    if (meta) {
      var by = board.seatsByRound || {};
      meta.textContent =
        (board.seatsTakenAll != null ? board.seatsTakenAll : rows.length) + ' seats on the field' +
        ' · R1 ' + (by[1] || 0) + ' · R2 ' + (by[2] || 0) +
        ' · attributed vol ' + fmtUsd(board.totalAttributedVolumeUsd);
    }
    if (!rows.length) {
      $('boardList').textContent = 'No seats yet — first $500 buy-in opens the field.';
      return;
    }
    var marks = stages.map(function (s) { return esc(s.name); }).join('');
    $('boardList').innerHTML = rows.map(function (s) {
      var mine = (myRef && s.ref === myRef) || (myWallet && s.wallet === myWallet);
      var path = s.path || {};
      var stageName = (path.stage && path.stage.name) || 'Seated';
      var pctBar = overallProgress(path, stages) * 100;
      var roundTag = 'R' + (Number(s.round) === 2 ? '2' : '1');
      return (
        '<div class="seat-lane' + (mine ? ' mine' : '') + '" data-testid="seat-lane-' + esc(s.ref) + '">' +
        '<div class="seat-lane-top">' +
        '<div><strong>' + esc(s.ref) + '</strong> · ' + esc(stageName) +
        ' <span class="seat-round-tag">' + roundTag + '</span>' +
        '<div class="mono" style="font-size:0.75rem;color:var(--text-muted)">' +
        esc(short(s.wallet)) + ' · seat ' + fmtUsd(s.usd) + '</div></div>' +
        '<div style="text-align:right"><div>' + fmtUsd(s.workUsd) + ' vol</div>' +
        '<div class="mono" style="font-size:0.75rem">MTD ' + fmtUsd(s.monthUsd) + '</div></div>' +
        '</div>' +
        '<div class="seat-lane-bar"><i style="width:' + pctBar.toFixed(1) + '%"></i></div>' +
        '<div class="seat-lane-marks">' + marks + '</div>' +
        '</div>'
      );
    }).join('');
  }

  function renderAttrLine(board) {
    var line = $('attrLiveLine');
    if (!line) return;
    var ref = P.getRef() || P.cleanRef($('ref').value);
    if (board && board.mine && board.mine.ref) {
      line.innerHTML =
        'Your seat ref <span class="mono"><strong>' + esc(board.mine.ref) +
        '</strong></span> is bound. Share pack links — every Pool Pilot swap with that ref credits this lane.';
      return;
    }
    if (ref) {
      line.innerHTML =
        'Sticky ref <span class="mono"><strong>' + esc(ref) +
        '</strong></span> — swaps on this browser attribute here until you change it.';
      return;
    }
    line.textContent =
      'No ref bound yet. Buy a seat or open a ?ref= link — connecting your seat wallet also auto-binds.';
  }

  function renderMine(board) {
    var mine = board.mine;
    if (!mine) {
      $('mineEmpty').classList.remove('hidden');
      $('mineBody').classList.add('hidden');
      return;
    }
    $('mineEmpty').classList.add('hidden');
    $('mineBody').classList.remove('hidden');
    var path = mine.path || {};
    if ($('payVol')) $('payVol').textContent = fmtUsd(path.workUsd);
    if ($('payMonth')) $('payMonth').textContent = fmtUsd(path.monthUsd);
    var stage = path.stage || {};
    if ($('payStage')) $('payStage').textContent = stage.name || 'Seated';
    if ($('econLine')) {
      $('econLine').textContent =
        (path.economics && path.economics.note) ||
        (board.economics && board.economics.note) ||
        'No monthly payout. Desk skim stays with Pool Pilot. Your wall is your upside.';
    }
    $('mineStageLabel').textContent = 'Stage · ' + (stage.name || 'Seated');
    var ms = path.milestones || [];
    $('mineMilestones').innerHTML = ms.map(function (m) {
      var cls = 'seat-ms';
      if (m.reached) cls += ' reached';
      if (m.current) cls += ' current';
      if (m.next) cls += ' next';
      return (
        '<div class="' + cls + '">' +
        '<div><div class="ms-name">' + esc(m.name) + '</div>' +
        '<div class="ms-meta">' + esc(fmtVol(m.volumeUsd)) + ' attributed volume</div></div>' +
        '</div>'
      );
    }).join('');
    if (path.nextStage) {
      var need = Math.max(0, path.nextStage.volumeUsd - (path.workUsd || 0));
      $('mineNextLine').textContent =
        'Next: ' + path.nextStage.name + ' at ' + fmtVol(path.nextStage.volumeUsd) +
        ' — ' + fmtUsd(need) + ' volume to go.';
    } else {
      $('mineNextLine').textContent = 'Top milestone reached. Keep links live to stay on the field.';
    }

    $('mineWallet').textContent = mine.wallet;
    $('mineBuyin').textContent =
      fmtUsd(mine.usd) +
      (mine.eth != null ? ' · ' + Number(mine.eth).toFixed(5) + ' ETH' : '') +
      ' · round ' + mine.round;
    if (mine.pool) {
      $('minePool').innerHTML =
        '<a href="' + esc(explorerAddr(mine.pool)) + '" target="_blank" rel="noopener">' +
        esc(short(mine.pool)) + '</a> · ' + esc(mine.symbol || 'TOKEN');
    } else {
      $('minePool').textContent = 'Uniswap v3 buy wall (see mint tx)';
    }
    if (mine.hash) {
      $('mineTx').innerHTML =
        '<a href="' + esc(explorerTx(mine.hash)) + '" target="_blank" rel="noopener">' +
        esc(short(mine.hash)) + '</a>';
    } else {
      $('mineTx').textContent = '—';
    }
    var withdrawHref = '/?token=' + encodeURIComponent(mine.token || ChainLib.CFG.MCFL);
    $('mineWithdraw').innerHTML =
      'One click below — pulls your seat NFT liquidity back to this wallet. Or open ' +
      '<a href="' + esc(withdrawHref) + '" rel="noopener">Pool Pilot positions</a>.';
    if ($('mineWithdrawBtn')) {
      $('mineWithdrawBtn').dataset.token = mine.token || ChainLib.CFG.MCFL;
    }

    var stageId = stage.id || 'seated';
    var adviceEl = $('mineStageAdvice');
    if (adviceEl) {
      if (stageId === 'seated') {
        adviceEl.textContent = 'Parked. Drive volume with your ref — don’t add more ETH into the same thin band until Ignite.';
      } else if (stageId === 'ignite' || stageId === 'breakout') {
        adviceEl.textContent =
          'Stage unlocked. Prefer bridging MCFL (Sol→RH) to deepen sell-side over stacking more ETH in one wall. Ladder already protects dumps.';
      } else {
        adviceEl.textContent =
          'You’re past early stages — keep links live. Withdraw or rebalance NFTs anytime; you own them.';
      }
    }

    var links = P.buildLinks({ ref: mine.ref, symbol: mine.symbol || 'MCFL', token: mine.token });
    $('minePack').href = links.pack;
    $('minePartner').href = links.partner;
    if (adviceEl) {
      adviceEl.innerHTML =
        (adviceEl.textContent ? adviceEl.textContent + ' ' : '') +
        'Share: <a href="' + esc(links.arrive) + '" target="_blank" rel="noopener">Arrive</a> · ' +
        '<a href="' + esc(links.swap) + '" target="_blank" rel="noopener">Swap</a> · ' +
        '<a href="' + esc(links.mini) + '" target="_blank" rel="noopener">Mini App</a> ' +
        '<span class="mono">(ref=' + esc(mine.ref) + ')</span>';
    }
  }

  function showPlanProtections(plan) {
    var box = $('protectAlerts');
    if (!box) return;
    var p = plan && plan.protections;
    if (!p) {
      box.innerHTML = '';
      return;
    }
    var html = '';
    (p.warnings || []).forEach(function (w) {
      html += '<div class="warn-item">' + esc(w) + '</div>';
    });
    (p.advice || []).forEach(function (a) {
      html += '<div class="advice-item">' + esc(a) + '</div>';
    });
    if (p.pool) {
      html +=
        '<div class="advice-item">Live pool · ETH side ~' + fmtUsd(p.pool.wethUsd) +
        ' · MCFL side ~' + fmtUsd(p.pool.tokenUsd) +
        (plan.mode === 'dual-ladder' ? ' · dual sell wall armed' : '') +
        (plan.capped ? ' · deposit auto-capped to ' + fmtUsd(plan.usd) : '') +
        '</div>';
    }
    box.innerHTML = html;
  }

  function loadPoolDepth() {
    var line = $('poolDepthLine');
    if (!line) return;
    L.fetchEthUsd().then(function (ethUsd) {
      S.ethUsd = ethUsd;
      return L.discoverPool(read, CFG.MCFL).then(function (info) {
        return L.readState(read, info, ethUsd).then(function (state) {
          line.textContent =
            'Live MCFL pool · buy-side (ETH) ~' + fmtUsd(state.buySideUsd) +
            ' · sell-side (MCFL) ~' + fmtUsd(state.sellSideUsd) +
            ' (~' + Math.round(state.sellSideTokens).toLocaleString() + ' MCFL). ' +
            'Buys clear sell-side; your seat wall sits below spot.';
        });
      });
    }).catch(function () {
      line.textContent = 'Pool depth unavailable right now.';
    });
  }

  function loadBoard() {
    var ref = P.cleanRef($('ref').value);
    var q = '/api/seats?';
    if (ref) q += 'ref=' + encodeURIComponent(ref) + '&';
    if (S.wallet.addr) q += 'wallet=' + encodeURIComponent(S.wallet.addr) + '&';
    return fetch(apiBase() + q, { headers: { Accept: 'application/json' }, mode: 'cors' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.ok) {
          $('boardList').textContent = 'Board unavailable — is the partner API running?';
          return;
        }
        renderRound(j);
        renderBoard(j);
        renderMine(j);
        renderAttrLine(j);
        loadPoolDepth();
        if (j.mine && j.mine.ref) {
          P.setRef(j.mine.ref);
          if (!$('ref').value) $('ref').value = j.mine.ref;
        }
      })
      .catch(function () {
        $('boardList').textContent = 'Could not reach partner API.';
      });
  }

  function updateEthPreview() {
    var usd = Number($('usd').value);
    var p = function (ethUsd) {
      S.ethUsd = ethUsd;
      if (!isFinite(usd) || usd <= 0 || !ethUsd) {
        $('ethPreview').textContent = 'ETH ≈ …';
        return;
      }
      var eth = usd / ethUsd;
      $('ethPreview').textContent =
        'You deposit ≈ ' + eth.toFixed(5) + ' ETH (@ $' + Math.round(ethUsd) + '/ETH). Still yours in the NFT.';
    };
    if (S.ethUsd) p(S.ethUsd);
    else L.fetchEthUsd().then(p).catch(function () { $('ethPreview').textContent = 'ETH ≈ (price feed loading…)'; });
  }

  function registerSeat(plan, hash) {
    var headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (window.POOL_PILOT_PARTNER_KEY) headers['X-Partner-Key'] = String(window.POOL_PILOT_PARTNER_KEY);
    return fetch(apiBase() + '/api/seats', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        ref: P.cleanRef($('ref').value),
        wallet: S.wallet.addr,
        usd: plan.usd,
        eth: plan.ethInF,
        hash: hash,
        token: plan.token,
        symbol: plan.symbol,
        pool: plan.pool,
        note: 'seat-buyin'
      }),
      mode: 'cors'
    }).then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); });
  }

  function buySeat() {
    showErr('');
    if (S.busy) return;
    var ref = P.cleanRef($('ref').value);
    if (!ref) {
      showErr('Pick a partner ref (letters, numbers, _ or -).');
      return;
    }
    P.setRef(ref);
    var usd = Number($('usd').value);
    var r = S.round;
    if (r && (usd < r.usdMin || usd > r.usdMax)) {
      showErr('Seat is $' + r.usdMin + (r.usdMin === r.usdMax ? '' : ('–$' + r.usdMax)) + ' this round.');
      return;
    }
    if (S.board && !S.board.open) {
      showErr('This round is full.');
      return;
    }

    var go = function () {
      if (!S.wallet.chainOk) {
        showErr('Switch to Robinhood Chain (4663) first.');
        return;
      }
      var token = P.cleanToken($('token').value) || CFG.MCFL;
      S.busy = true;
      $('buyBtn').disabled = true;
      $('buyBtn').textContent = 'Building…';
      $('execBox').classList.remove('hidden');
      $('execBox').textContent = 'Reading pool…';

      L.planSeatDeposit(read, {
        usdAmount: usd,
        walletAddr: S.wallet.addr,
        token: token,
        ethUsd: S.ethUsd
      }).then(function (plan) {
        S.plan = plan;
        showPlanProtections(plan);
        var dualNote = plan.dual
          ? (' + sell wall (~' + fmtUsd(plan.dual.tokenUsd) + ' ' + esc(plan.symbol) + ')')
          : '';
        $('execBox').innerHTML =
          'Deposit <strong>' + esc(plan.ethInF.toFixed(5)) + ' ETH</strong> (~' + fmtUsd(plan.usd) + ')' +
          ' as a <strong>3-band buy wall</strong>' + dualNote + '.<br>' +
          'Pool <a href="' + esc(plan.explorerPool) + '" target="_blank" rel="noopener">' +
          esc(short(plan.pool)) + '</a> — you own the NFT(s). ' +
          plan.txs.length + ' step' + (plan.txs.length === 1 ? '' : 's') + '.';
        var signer = S.wallet.provider.getSigner();
        var hashes = [];
        var chain = Promise.resolve();
        plan.txs.forEach(function (tx, i) {
          chain = chain.then(function () {
            $('buyBtn').textContent = 'Confirm step ' + (i + 1) + '/' + plan.txs.length + '…';
            $('execBox').innerHTML += '<br>' + esc(tx.label || ('Step ' + (i + 1)));
            return signer.sendTransaction({
              to: tx.to,
              data: tx.data || '0x',
              value: tx.value || '0x0'
            }).then(function (resp) {
              hashes.push(resp.hash);
              $('execBox').innerHTML +=
                ' · <a href="' + esc(explorerTx(resp.hash)) + '" target="_blank" rel="noopener">' +
                esc(short(resp.hash)) + '</a>';
              return read.waitForTransaction(resp.hash, 1, 180000).then(function (rc) {
                if (!rc || rc.status !== 1) throw new Error('Transaction reverted.');
              });
            });
          });
        });
        return chain.then(function () {
          var hash = hashes[hashes.length - 1];
          return registerSeat(plan, hash).then(function (reg) {
            if (!reg.j || !reg.j.ok) {
              throw new Error((reg.j && reg.j.error) || 'Seat registered on-chain but API failed — keep your tx hash.');
            }
            $('execBox').innerHTML += '<br><strong>Seat live.</strong> Ladder is below spot; withdraw anytime from your NFTs.';
            return loadBoard();
          });
        });
      }).catch(function (e) {
        showErr((e && e.message) || String(e));
      }).then(function () {
        S.busy = false;
        $('buyBtn').disabled = false;
        $('buyBtn').textContent = 'Buy $500 seat';
      });
    };

    if (!S.wallet.addr) {
      connect().then(go).catch(function (e) { showErr((e && e.message) || e); });
    } else go();
  }

  function withdrawSeatLp() {
    showErr('');
    if (S.busy) return;
    var go = function () {
      if (!S.wallet.chainOk) {
        showErr('Switch to Robinhood Chain (4663) first.');
        return;
      }
      var btn = $('mineWithdrawBtn');
      var token = (btn && btn.dataset.token) || CFG.MCFL;
      S.busy = true;
      if (btn) { btn.disabled = true; btn.textContent = 'Reading…'; }
      $('execBox').classList.remove('hidden');
      $('execBox').textContent = 'Finding your LP positions…';

      L.discoverPool(read, token).then(function (info) {
        return L.fetchEthUsd().then(function (ethUsd) {
          return L.readState(read, info, ethUsd, S.wallet.addr);
        });
      }).then(function (state) {
        var plan = L.planExitPositions(state, S.wallet.addr);
        if (!plan.txs.length) {
          $('execBox').textContent = 'No live liquidity on this wallet for that pool.';
          return;
        }
        $('execBox').textContent =
          'Withdrawing ' + plan.summary.count + ' position(s)… confirm in wallet.';
        var signer = S.wallet.provider.getSigner();
        var chain = Promise.resolve();
        plan.txs.forEach(function (t) {
          chain = chain.then(function () {
            return signer.sendTransaction({
              to: t.to,
              data: t.data,
              value: t.value || '0x0'
            }).then(function (tx) {
              $('execBox').innerHTML =
                'Submitted <a href="' + esc(explorerTx(tx.hash)) + '" target="_blank" rel="noopener">' +
                esc(short(tx.hash)) + '</a> — waiting…';
              return tx.wait();
            });
          });
        });
        return chain.then(function () {
          $('execBox').innerHTML =
            '<strong>LP withdrawn.</strong> Tokens are back in your wallet. Empty NFTs may remain.';
        });
      }).catch(function (e) {
        showErr((e && e.message) || String(e));
      }).then(function () {
        S.busy = false;
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Withdraw LP to wallet';
        }
      });
    };

    if (!S.wallet.addr) {
      connect().then(go).catch(function (e) { showErr((e && e.message) || e); });
    } else go();
  }

  $('buyBtn').addEventListener('click', buySeat);
  if ($('mineWithdrawBtn')) $('mineWithdrawBtn').addEventListener('click', withdrawSeatLp);
  $('refreshBtn').addEventListener('click', loadBoard);
  $('usd').addEventListener('input', updateEthPreview);
  $('ref').addEventListener('change', function () {
    var r = P.cleanRef($('ref').value);
    if (r) {
      P.setRef(r);
      $('ref').value = r;
    }
    loadBoard();
  });

  P.captureRefFromUrl();
  if (P.getRef()) $('ref').value = P.getRef();
  var q = new URLSearchParams(location.search);
  if (q.get('token')) $('token').value = q.get('token');

  loadBoard();
  updateEthPreview();
})();
