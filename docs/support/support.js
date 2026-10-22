'use strict';
(() => {
  const address = document.getElementById('wallet-address');
  const button = document.getElementById('copy-address');
  const status = document.getElementById('copy-status');
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(address.value);
      status.textContent = '已复制 USDT · Solana 收款地址';
    } catch {
      address.focus();
      address.select();
      status.textContent = '自动复制不可用，已选中地址，请手动复制。';
    }
  });
})();
