import { parseAbi } from 'viem';

export const poolManagerEvents = parseAbi([
  'event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)',
  'event ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)',
  'event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)',
]);

export const hookEvents = parseAbi([
  'event FeeTaken(bytes32 indexed id, address currency, uint256 platform, uint256 creator)',
  'event CreatorShareSplit(bytes32 indexed id, uint256 burnt, uint256 toLiquidity, uint256 paid)',
  'event BoughtBackAndBurnt(bytes32 indexed id, uint256 spent, uint256 burnt)',
  'event LiquidityAdded(bytes32 indexed id, address currency, uint256 amount, uint128 liquidity)',
]);

export const hookRead = [
  {
    type: 'function',
    name: 'configOf',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }],
    outputs: [
      { name: 'buyTaxBps', type: 'uint16' },
      { name: 'sellTaxBps', type: 'uint16' },
      { name: 'burnBps', type: 'uint16' },
      { name: 'liquidityBps', type: 'uint16' },
      { name: 'tokenIsCurrency0', type: 'bool' },
      { name: 'set', type: 'bool' },
      { name: 'sniperEndsAt', type: 'uint64' },
      { name: 'sniperWindow', type: 'uint32' },
      { name: 'sniperStartBps', type: 'uint16' },
    ],
  },
  {
    type: 'function',
    name: 'payees',
    stateMutability: 'view',
    inputs: [
      {
        name: 'key',
        type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
      },
    ],
    outputs: [
      {
        type: 'tuple[]',
        components: [
          { name: 'to', type: 'address' },
          { name: 'shareBps', type: 'uint16' },
        ],
      },
    ],
  },
  { type: 'function', name: 'platformTreasury', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'launcher', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'platformAdmin', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
];

export const erc20 = parseAbi([
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function maxWalletBps() view returns (uint16)',
  'function exemptFromMaxWallet(address) view returns (bool)',
  'function rewardTracker() view returns (address)',
  'function launched() view returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);
