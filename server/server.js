require('dotenv').config({ path: './.env' });
const express = require('express');
const { Alchemy, Network } = require('alchemy-sdk');
const axios = require('axios');
const fs = require('fs');
const app = express();

// Configure Alchemy SDK
const config = {
  apiKey: process.env.ALCHEMY_API_KEY,
  network: Network.ETH_MAINNET,
};
const alchemy = new Alchemy(config);

// Load or initialize price cache with TTL
const priceCacheFile = 'prices.json';
let priceCache = {};
if (fs.existsSync(priceCacheFile)) {
  try {
    priceCache = JSON.parse(fs.readFileSync(priceCacheFile));
    const now = Date.now();
    Object.keys(priceCache).forEach(key => {
      if (!priceCache[key].price || isNaN(priceCache[key].price) || now - priceCache[key].timestamp > 3600000) {
        delete priceCache[key];
      }
    });
  } catch (error) {
    console.error(`Failed to load price cache: ${error.message}`);
    priceCache = {};
  }
}

// Fetch top 500 tokens from CoinGecko (run once or periodically)
let topTokens = {};
async function fetchTopTokens() {
  try {
    const pages = [1, 2, 3, 4]; // 4 pages x 250 tokens = 1000, take top 500
    const tokenPromises = pages.map(page =>
      axios.get(`https://api.coingecko.com/api/v3/coins/markets`, {
        params: {
          vs_currency: 'usd',
          order: 'market_cap_desc',
          per_page: 250,
          page,
          sparkline: false
        },
        timeout: 10000
      })
    );
    const responses = await Promise.all(tokenPromises);
    const allTokens = responses.flatMap(res => res.data);
    for (const token of allTokens.slice(0, 500)) {
      const contract = token.platforms?.ethereum?.toLowerCase();
      if (contract) {
        topTokens[contract] = token.current_price || 0;
        priceCache[contract] = { price: topTokens[contract], timestamp: Date.now() };
      }
    }
    fs.writeFileSync(priceCacheFile, JSON.stringify(priceCache));
    console.log(`Fetched prices for ${Object.keys(topTokens).length} top tokens`);
  } catch (error) {
    console.error(`Failed to fetch top tokens: ${error.message}`);
  }
}
// Fetch top tokens on startup
fetchTopTokens();

app.use(express.json());

// Enable CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Fetch token balances
app.get('/api/tokens/:wallet', async (req, res) => {
  try {
    const startTime = Date.now();
    // Resolve ENS or validate address
    let wallet = req.params.wallet;
    if (wallet.includes('.eth')) {
      wallet = await alchemy.core.resolveName(wallet);
      if (!wallet) throw new Error('Invalid ENS name');
    }
    if (!wallet.match(/^0x[a-fA-F0-9]{40}$/)) {
      throw new Error('Invalid Ethereum address');
    }

    // Fetch token balances
    const balances = await alchemy.core.getTokenBalances(wallet);
    console.log(`Fetched ${balances.tokenBalances.length} tokens for ${wallet} in ${Date.now() - startTime}ms`);

    // Deduplicate tokens by contract address
    const tokenMap = new Map();
    const contractAddresses = [];
    for (const token of balances.tokenBalances.filter(t => parseInt(t.tokenBalance, 16) > 0)) {
      const contractAddress = token.contractAddress.toLowerCase();
      tokenMap.set(contractAddress, token);
      contractAddresses.push(contractAddress);
    }

    // Fetch token metadata in batch
    const tokens = [];
    const metadataPromises = contractAddresses.map(async contractAddress => {
      try {
        const metadata = await alchemy.core.getTokenMetadata(contractAddress);
        return { contractAddress, metadata };
      } catch (error) {
        console.error(`Metadata fetch failed for ${contractAddress}: ${error.message}`);
        return { contractAddress, metadata: { decimals: 18, symbol: 'UNKNOWN', logo: null } };
      }
    });
    const metadataResults = await Promise.all(metadataPromises);

    for (const { contractAddress, metadata } of metadataResults) {
      const token = tokenMap.get(contractAddress);
      const balance = parseInt(token.tokenBalance, 16);
      tokens.push({
        contractAddress,
        balance,
        decimals: metadata.decimals || 18,
        symbol: metadata.symbol || 'UNKNOWN',
        logo: metadata.logo || `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/${contractAddress}/logo.png`
      });
    }

    // Apply prices from cache or top tokens
    tokens.forEach(token => {
      token.price = priceCache[token.contractAddress]?.price || topTokens[token.contractAddress] || 0;
    });

    console.log(`Returning ${tokens.length} unique tokens for ${wallet} in ${Date.now() - startTime}ms`);
    res.json(tokens);
  } catch (error) {
    console.error(`Token endpoint error for ${req.params.wallet}: ${error.message}`);
    res.status(500).json({ error: `Failed to fetch tokens: ${error.message}` });
  }
});

app.listen(5000, () => console.log('Server running on http://localhost:5000'));