// Sim G: ETH fee payment as treasury-owned buy-side LP mint (no swap, no impact)
var ethers = require('ethers');
global.window = undefined;
var L = require('../js/chainlib.js');
var CFG = L.CFG;

var FORK = 'http://127.0.0.1:8545';
var STRANGER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

var POOL_ABI = ['function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16,uint16,uint16,uint8,bool)'];
var NPM_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function tokenOfOwnerByIndex(address,uint256) view returns (uint256)',
  'function positions(uint256) view returns (uint96 nonce,address operator,address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint128 liquidity,uint256,uint256,uint128,uint128)',
  'function ownerOf(uint256) view returns (address)'
];

async function main() {
  var provider = new ethers.providers.JsonRpcProvider(FORK);
  var wallet = new ethers.Wallet(STRANGER_KEY, provider);
  await provider.send('anvil_setBalance', [wallet.address, '0x8AC7230489E80000']); // 10 ETH

  var ethUsd = await L.fetchEthUsd().catch(function () { return 1912; });
  console.log('ETH/USD', ethUsd);

  var quote = await L.quoteFee(provider, ethUsd);
  console.log('fee quote: ethIn', ethers.utils.formatEther(quote.ethIn), 'ETH = $' + quote.usdIn, '| tick', quote.tick);

  var pool = new ethers.Contract(quote.info.pool, POOL_ABI, provider);
  var npm = new ethers.Contract(CFG.NPM, NPM_ABI, provider);

  var tickBefore = (await pool.slot0()).tick;
  var balBefore = await npm.balanceOf(CFG.TREASURY);
  var ethBefore = await provider.getBalance(wallet.address);

  var tx = L.payFeeWithEthTx(quote);
  console.log('tx target NPM?', tx.to === CFG.NPM, '| band', tx.mintParams.tickLower, tx.mintParams.tickUpper, '| current tick', tickBefore);

  var sent = await wallet.sendTransaction({ to: tx.to, data: tx.data, value: tx.value, gasLimit: 900000 });
  var rec = await sent.wait();
  console.log('mined, status', rec.status, 'gasUsed', rec.gasUsed.toString());

  var tickAfter = (await pool.slot0()).tick;
  var balAfter = await npm.balanceOf(CFG.TREASURY);
  var ethAfter = await provider.getBalance(wallet.address);

  console.log('TICK before/after:', tickBefore, tickAfter, '=> price impact:', tickBefore === tickAfter ? 'NONE ✓' : 'MOVED ✗');
  console.log('treasury NFT count before/after:', balBefore.toString(), balAfter.toString());

  if (!balAfter.gt(balBefore)) throw new Error('treasury did not receive a position');
  var newId = await npm.tokenOfOwnerByIndex(CFG.TREASURY, balAfter.sub(1));
  var p = await npm.positions(newId);
  var owner = await npm.ownerOf(newId);
  console.log('new position #' + newId.toString(), 'owner', owner, 'liquidity', p.liquidity.toString(), 'range', p.tickLower, p.tickUpper);
  if (owner.toLowerCase() !== CFG.TREASURY.toLowerCase()) throw new Error('owner mismatch');
  if (p.liquidity.lte(0)) throw new Error('zero liquidity');

  var spent = ethBefore.sub(ethAfter);
  console.log('ETH spent (incl gas):', ethers.utils.formatEther(spent));
  var expected = parseFloat(ethers.utils.formatEther(quote.ethIn));
  var spentF = parseFloat(ethers.utils.formatEther(spent));
  if (spentF > expected * 1.15) throw new Error('spent too much: ' + spentF);
  console.log('SIM G PASS ✓ — fee payment minted treasury buy wall, zero price impact, refund OK');
}

main().catch(function (e) { console.error('SIM G FAIL:', e.message); process.exit(1); });
