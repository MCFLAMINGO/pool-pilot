const lib = require('../js/chainlib.js');
const { ethers } = require('ethers');
const CFG = lib.CFG;
const ERIK = '0x1aa92670a4e680081c407e060a3e8bc3d1929a13';

async function rpc(provider, method, params) {
  return provider.send(method, params);
}

(async () => {
  const provider = lib.getProvider();
  const ethUsd = await lib.fetchEthUsd(global.fetch);
  console.log('ETH/USD =', ethUsd);

  // ---- 0. does eth_call support state overrides? ----
  const bal = ethers.utils.parseEther('1').toHexString();
  try {
    const r = await rpc(provider, 'eth_call', [
      { from: ERIK, to: CFG.WETH, data: lib.ifaces.weth.encodeFunctionData('deposit', []), value: ethers.utils.parseEther('0.5').toHexString() },
      'latest',
      { [ERIK]: { balance: bal } }
    ]);
    console.log('override support: YES (deposit sim ok:', r + ')');
  } catch (e) {
    console.log('override support: NO —', e.message.slice(0, 120));
  }

  // ---- find WETH balanceOf storage slot using the MCFL pool's known balance ----
  const POOL = '0x8b28d33fa95018e9773725f04b664b0fb9875aed';
  const weth = new ethers.Contract(CFG.WETH, ['function balanceOf(address) view returns (uint256)','function allowance(address,address) view returns (uint256)'], provider);
  const poolBal = await weth.balanceOf(POOL);
  let balSlot = -1;
  for (let i = 0; i < 12; i++) {
    const key = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(['address','uint256'], [POOL, i]));
    const v = await provider.getStorageAt(CFG.WETH, key);
    if (ethers.BigNumber.from(v).eq(poolBal)) { balSlot = i; break; }
  }
  console.log('WETH balanceOf slot:', balSlot, '(pool bal', ethers.utils.formatEther(poolBal), ')');

  // real allowances Erik already granted
  const mcfl = new ethers.Contract(CFG.MCFL, ['function allowance(address,address) view returns (uint256)','function balanceOf(address) view returns (uint256)'], provider);
  const [aW, aM, balM, balE] = await Promise.all([
    weth.allowance(ERIK, CFG.NPM), mcfl.allowance(ERIK, CFG.NPM), mcfl.balanceOf(ERIK), provider.getBalance(ERIK)
  ]);
  console.log('erik: ETH', ethers.utils.formatEther(balE), '| MCFL', ethers.utils.formatEther(balM), '| allowW->NPM', ethers.utils.formatEther(aW), '| allowM->NPM', ethers.utils.formatEther(aM));
})();
