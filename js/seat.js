/* Pool Pilot partner seat — buy-in + share board */
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
  function pct(n) {
    if (n == null || !isFinite(n)) return '—';
    return (n * 100).toFixed(1) + '%';
  }
  function fmtUsd(n) {
    if (n == null || !isFinite(n)) return '—';
    if (n < 10) return '$' + n.toFixed(2);
    return '$' + Math.round(n).toLocaleString();
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
  function explorerTx(h) {
    return CFG.EXPLORER + '/tx/' + h;
  }
  function explorerAddr(a) {
    return CFG.EXPLORER + '/address/' + a;
  }

  function discoverProviders() {
    var out = [];
    var seen = [];
    function add(provider, name) {
      if (!provider || typeof provider.request !== 'function' || seen.indexOf(provider) !== -1) return;
      seen.push(provider);
      out.push({ provider: provider, name: name || 'Wallet' });
    }
    var ethereum = window.ethereum;
    if (ethereum) {
      if (ethereum.providers && ethereum.providers.length) {
        ethereum.providers.forEach(function (p) {
          add(p, p.isRabby ? 'Rabby' : p.isMetaMask ? 'MetaMask' : 'Injected');
        });
      } else add(ethereum, ethereum.isRabby ? 'Rabby' : ethereum.isMetaMask ? 'MetaMask' : 'Injected');
    }
    return out;
  }

  function bindProvider(raw, addr) {
    var web3 = new ethers.providers.Web3Provider(raw, 'any');
    S.wallet = { addr: addr, provider: web3, chainOk: false };
    return web3.send('eth_chainId', []).then(function (id) {
      var ok = parseInt(id, 16) === CFG.CHAIN_ID;
      S.wallet.chainOk = ok;
      $('walletBtn').textContent = ok ? short(addr) : short(addr) + ' · switch';
      if (!ok) return ensureChain(raw);
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
    var list = discoverProviders();
    if (!list.length) {
      showErr('No wallet found. Install MetaMask or Rabby, then refresh.');
      return Promise.reject(new Error('No wallet'));
    }
    var raw = list[0].provider;
    return raw.request({ method: 'eth_requestAccounts' }).then(function (accs) {
      if (!accs || !accs[0]) throw new Error('No account returned.');
      return bindProvider(raw, accs[0]);
    });
  }

  $('walletBtn').addEventListener('click', function () {
    if (S.wallet.addr) {
      S.wallet = { addr: null, provider: null, chainOk: false };
      $('walletBtn').textContent = 'Connect';
      return;
    }
    connect().catch(function (e) { showErr((e && e.message) || e); });
  });

  function renderRound(board) {
    S.round = board.round;
    S.board = board;
    var r = board.round;
    $('roundKicker').textContent = 'Round ' + board.activeRound;
    $('tierPrice').textContent = '$' + r.usdMin + ' – $' + r.usdMax;
    $('tierName').textContent = r.name;
    $('seatsLeft').textContent = String(board.seatsLeft);
    $('raisedUsd').textContent = fmtUsd(board.raisedUsd);
    var fill = r.maxSeats > 0 ? (board.seatsTaken / r.maxSeats) * 100 : 0;
    $('progressBar').style.width = Math.min(100, fill) + '%';
    if (board.activeRound === 1) {
      $('nextRoundLine').textContent =
        'Round 2 opens at $1,000–$5,000 when Round 1 fills (' + r.maxSeats + ' seats), ' +
        'raises ~' + fmtUsd(r.advanceRaisedUsd) + ', or attributed volume clears ' +
        fmtUsd(board.advance && board.advance.needVolume) + '.';
    } else {
      $('nextRoundLine').textContent = 'Growth seats are open. Capital + work still set your weight.';
    }
    var usdEl = $('usd');
    var cur = Number(usdEl.value);
    if (!isFinite(cur) || cur < r.usdMin || cur > r.usdMax) {
      usdEl.value = String(Math.round((r.usdMin + r.usdMax) / 2));
    }
    usdEl.min = r.usdMin;
    usdEl.max = r.usdMax;
    updateEthPreview();
  }

  function renderBoard(board) {
    var rows = board.board || [];
    var myRef = P.cleanRef($('ref').value);
    var myWallet = (S.wallet.addr || '').toLowerCase();
    if (!rows.length) {
      $('boardList').textContent = 'No seats yet — first buy-in opens the board.';
      return;
    }
    var html =
      '<div class="seat-board-row head"><span>Ref</span><span>Capital</span><span>Work</span><span>Seat</span></div>' +
      rows.map(function (s) {
        var mine = (myRef && s.ref === myRef) || (myWallet && s.wallet === myWallet);
        return (
          '<div class="seat-board-row' + (mine ? ' mine' : '') + '">' +
          '<span><strong>' + esc(s.ref) + '</strong><br><span class="mono" style="font-size:0.75rem">' +
          esc(short(s.wallet)) + '</span></span>' +
          '<span>' + fmtUsd(s.usd) + '<br><span class="mono">' + pct(s.capitalShare) + '</span></span>' +
          '<span>' + fmtUsd(s.workUsd) + '<br><span class="mono">' + pct(s.workShare) + '</span></span>' +
          '<span class="mono">' + pct(s.seatShare) + '</span>' +
          '</div>'
        );
      }).join('');
    $('boardList').innerHTML = html;
  }

  function renderMine(board) {
    var mine = board.mine;
    if (!mine) {
      $('mineEmpty').classList.remove('hidden');
      $('mineBody').classList.add('hidden');
      $('mineEmpty').textContent = 'Buy a seat (or load your ref) to see where your ETH sits and your share.';
      return;
    }
    $('mineEmpty').classList.add('hidden');
    $('mineBody').classList.remove('hidden');
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
    $('shareCapital').textContent = pct(mine.capitalShare);
    $('shareWork').textContent = pct(mine.workShare);
    $('shareSeat').textContent = pct(mine.seatShare);
    $('barCapital').style.width = Math.min(100, (mine.capitalShare || 0) * 100) + '%';
    $('barWork').style.width = Math.min(100, (mine.workShare || 0) * 100) + '%';
    $('barSeat').style.width = Math.min(100, (mine.seatShare || 0) * 100) + '%';
    $('mineWorkLine').textContent =
      'Attributed desk volume for ref “' + mine.ref + '”: ' + fmtUsd(mine.workUsd) +
      '. Work share rises as your Arrive / swap / Mini App links convert.';
    var links = P.buildLinks({ ref: mine.ref, symbol: mine.symbol || 'MCFL', token: mine.token });
    $('minePack').href = links.pack;
    $('minePartner').href = links.partner;
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
      var r = S.round;
      var tip = r ? ('Buy-in window $' + r.usdMin + '–$' + r.usdMax) : '';
      $('ethPreview').textContent =
        'You deposit ≈ ' + eth.toFixed(5) + ' ETH (@ $' + Math.round(ethUsd) + '/ETH). ' + tip;
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
      showErr('Buy-in must be $' + r.usdMin + '–$' + r.usdMax + ' for this round.');
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
        $('execBox').innerHTML =
          'Deposit <strong>' + esc(plan.ethInF.toFixed(5)) + ' ETH</strong> (~' + fmtUsd(plan.usd) + ')' +
          ' into <strong>' + esc(plan.symbol) + '</strong> buy wall.<br>' +
          'Pool <a href="' + esc(plan.explorerPool) + '" target="_blank" rel="noopener">' +
          esc(short(plan.pool)) + '</a> — you own the NFT.';
        var signer = S.wallet.provider.getSigner();
        var tx = plan.txs[0];
        $('buyBtn').textContent = 'Confirm in wallet…';
        return signer.sendTransaction({
          to: tx.to,
          data: tx.data || '0x',
          value: tx.value || '0x0'
        }).then(function (resp) {
          $('execBox').innerHTML +=
            '<br>Tx <a href="' + esc(explorerTx(resp.hash)) + '" target="_blank" rel="noopener">' +
            esc(short(resp.hash)) + '</a> — waiting…';
          return read.waitForTransaction(resp.hash, 1, 180000).then(function (rc) {
            if (!rc || rc.status !== 1) throw new Error('Transaction reverted.');
            return registerSeat(plan, resp.hash).then(function (reg) {
              if (!reg.j || !reg.j.ok) {
                throw new Error((reg.j && reg.j.error) || 'Seat registered on-chain but API failed — keep your tx hash.');
              }
              $('execBox').innerHTML += '<br><strong>Seat live.</strong> Your ETH is in the pool above; share board updated.';
              return loadBoard();
            });
          });
        });
      }).catch(function (e) {
        showErr((e && e.message) || String(e));
      }).then(function () {
        S.busy = false;
        $('buyBtn').disabled = false;
        $('buyBtn').textContent = 'Buy seat';
      });
    };

    if (!S.wallet.addr) {
      connect().then(go).catch(function (e) { showErr((e && e.message) || e); });
    } else go();
  }

  $('buyBtn').addEventListener('click', buySeat);
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
  if (q.get('usd')) $('usd').value = q.get('usd');
  if (q.get('token')) $('token').value = q.get('token');

  loadBoard();
  updateEthPreview();
})();
