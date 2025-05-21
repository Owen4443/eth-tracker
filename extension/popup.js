document.addEventListener('DOMContentLoaded', () => {
  const walletInput = document.getElementById('walletAddress');
  const fetchButton = document.getElementById('fetchBalances');
  const tokenList = document.getElementById('tokenList');
  const errorMessage = document.getElementById('errorMessage');

  // Format number with commas
  function formatNumber(num, decimals = 4) {
    const [integer, fraction] = num.toFixed(decimals).split('.');
    const formattedInteger = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return fraction ? `${formattedInteger}.${fraction}` : formattedInteger;
  }

  // Format currency with commas
  function formatCurrency(num) {
    const [integer, fraction] = num.toFixed(2).split('.');
    const formattedInteger = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `$${formattedInteger}.${fraction}`;
  }

  fetchButton.addEventListener('click', async () => {
    const walletAddress = walletInput.value.trim();
    if (!walletAddress) {
      errorMessage.textContent = 'Please enter a wallet address';
      return;
    }

    errorMessage.textContent = '';
    tokenList.innerHTML = '<li>Loading tokens...</li>';

    try {
      const response = await fetch(`http://localhost:5000/api/tokens/${walletAddress}`);
      if (!response.ok) throw new Error('Failed to fetch token balances');
      const tokens = await response.json();

      if (tokens.length === 0) {
        tokenList.innerHTML = '<li>No tokens found</li>';
        return;
      }

      tokenList.innerHTML = '';
      tokens
        .sort((a, b) => (b.balance / Math.pow(10, b.decimals) * b.price) - (a.balance / Math.pow(10, a.decimals) * a.price))
        .forEach(token => {
          const li = document.createElement('li');
          const balance = token.balance / Math.pow(10, token.decimals);
          const value = balance * token.price;
          li.innerHTML = `
            <img src="${token.logo}" alt="${token.symbol} Logo">
            <div>
              <p>${token.symbol}</p>
              <p>Balance: ${formatNumber(balance)}</p>
              <p>Value: ${formatCurrency(value)}</p>
            </div>
          `;
          tokenList.appendChild(li);
        });
    } catch (error) {
      errorMessage.textContent = `Error: ${error.message}`;
      tokenList.innerHTML = '';
    }
  });
});