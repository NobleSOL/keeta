// src/routes/pools.js
import express from 'express';
import { getPoolManager } from '../contracts/PoolManager.js';

const router = express.Router();

/**
 * GET /api/pools
 * Get all pools
 */
router.get('/', async (req, res) => {
  try {
    const poolManager = await getPoolManager();
    const allPools = await poolManager.getAllPoolsInfo();

    // Filter out pools with 0 reserves (empty/removed pools)
    const activePools = allPools.filter(pool => {
      const reserveA = BigInt(pool.reserveA);
      const reserveB = BigInt(pool.reserveB);
      return reserveA > 0n && reserveB > 0n;
    });

    res.json({
      success: true,
      pools: activePools,
      count: activePools.length,
    });
  } catch (error) {
    console.error('Get pools error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/pools/:tokenA/:tokenB
 * Get specific pool info
 */
router.get('/:tokenA/:tokenB', async (req, res) => {
  try {
    const { tokenA, tokenB } = req.params;

    const poolManager = await getPoolManager();
    const pool = poolManager.getPool(tokenA, tokenB);

    if (!pool) {
      return res.status(404).json({
        success: false,
        error: 'Pool not found',
      });
    }

    const info = await pool.getPoolInfo();

    res.json({
      success: true,
      pool: info,
    });
  } catch (error) {
    console.error('Get pool error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/pools/create
 * Create a new pool (permissionless)
 * 
 * Body: {
 *   tokenA: string,
 *   tokenB: string
 * }
 */
router.post('/create', async (req, res) => {
  try {
    const { tokenA, tokenB } = req.body;

    if (!tokenA || !tokenB) {
      return res.status(400).json({
        error: 'Missing required fields: tokenA, tokenB',
      });
    }

    if (tokenA === tokenB) {
      return res.status(400).json({
        error: 'Cannot create pool with same token',
      });
    }

    const poolManager = await getPoolManager();

    // Check if pool already exists
    if (poolManager.hasPool(tokenA, tokenB)) {
      return res.status(409).json({
        success: false,
        error: 'Pool already exists',
      });
    }

    // Create pool
    const pool = await poolManager.createPool(tokenA, tokenB);
    const info = await pool.getPoolInfo();

    res.json({
      success: true,
      message: 'Pool created successfully',
      pool: info,
    });
  } catch (error) {
    console.error('Create pool error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/pools/:tokenA/:tokenB/stats
 * Get pool statistics
 */
router.get('/:tokenA/:tokenB/stats', async (req, res) => {
  try {
    const { tokenA, tokenB } = req.params;

    const poolManager = await getPoolManager();
    const stats = await poolManager.getPoolStats(tokenA, tokenB);

    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error('Get pool stats error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/pools/exists/:tokenA/:tokenB
 * Check if a pool exists
 */
router.get('/exists/:tokenA/:tokenB', async (req, res) => {
  try {
    const { tokenA, tokenB } = req.params;

    const poolManager = await getPoolManager();
    const exists = poolManager.hasPool(tokenA, tokenB);

    res.json({
      success: true,
      exists,
    });
  } catch (error) {
    console.error('Check pool exists error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
