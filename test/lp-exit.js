/* Unit: planExitPositions encodes decreaseLiquidity + collect. */
const assert = require('assert');
const { ethers } = require('ethers');
const L = require('../js/chainlib.js');

function check(name, cond) {
  if (!cond) throw new Error('FAIL: ' + name);
  console.log('ok', name);
}

const fakeState = {
  positions: {
    list: [
      { id: '42', liquidity: '1000', fees0: 0, fees1: 0, tickLower: -100, tickUpper: 100 },
      { id: '43', liquidity: '0', fees0: 0, fees1: 0, tickLower: -200, tickUpper: 0 },
      { id: '44', liquidity: '500', fees0: 1, fees1: 0, tickLower: -300, tickUpper: -100 }
    ]
  }
};
const wallet = '0x1Aa92670a4e680081c407E060A3E8BC3D1929a13';

const all = L.planExitPositions(fakeState, wallet);
check('exits live only', all.summary.count === 2);
check('ids', all.summary.tokenIds.join(',') === '42,44');
check('one multicall tx', all.txs.length === 1);
check('to NPM', all.txs[0].to.toLowerCase() === L.CFG.NPM.toLowerCase());

const iNPM = L.ifaces.npm;
const decoded = iNPM.decodeFunctionData('multicall', all.txs[0].data);
check('4 inner calls (2× decrease+collect)', decoded[0].length === 4);

const one = L.planExitPositions(fakeState, wallet, { tokenIds: ['42'] });
check('single id', one.summary.count === 1 && one.summary.tokenIds[0] === '42');
check('2 inner calls', iNPM.decodeFunctionData('multicall', one.txs[0].data)[0].length === 2);

const empty = L.planExitPositions({ positions: { list: [] } }, wallet);
check('empty no txs', empty.txs.length === 0 && empty.summary.count === 0);

const zeroLiq = L.planExitPositions(
  { positions: { list: [{ id: '9', liquidity: '0', fees0: 0, fees1: 0 }] } },
  wallet
);
check('zero liq no txs', zeroLiq.txs.length === 0);

console.log('LP EXIT OK');
