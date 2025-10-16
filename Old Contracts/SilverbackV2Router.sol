// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces.sol";
import "./interfaces.sol" as IFaces;
import "./SilverbackV2Pair.sol";
import "./interfaces.sol" as Lib;
import "./interfaces.sol";
import "./interfaces.sol";
import "./interfaces.sol";
import "./interfaces.sol";
import "./interfaces.sol";
import "./interfaces.sol";
import "./interfaces.sol";
import "./interfaces.sol";

import "./interfaces.sol";

import "./interfaces.sol";

import "./interfaces.sol";

import "./interfaces.sol";

import "./interfaces.sol";

import "./interfaces.sol";

import "./interfaces.sol";

import "./interfaces.sol";

import "./interfaces.sol";

// Note: minimal router implementing core add/remove/swap for SB-V2 pairs
contract SilverbackV2Router {
    using SilverbackV2Library for uint;

    address public immutable factory;
    address public immutable WETH;

    constructor(address _factory, address _WETH) {
        factory = _factory;
        WETH = _WETH;
    }

    receive() external payable {
        require(msg.sender == WETH, "NOT_WETH");
    }

    // --------- liquidity helpers ---------
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external returns (uint amountA, uint amountB, uint liquidity) {
        (amountA, amountB) = _addLiquidity(tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin);
        address pair = ISilverbackV2Factory(factory).getPair(tokenA, tokenB);
        if (pair == address(0)) {
            pair = ISilverbackV2Factory(factory).createPair(tokenA, tokenB);
        }
        IERC20(tokenA).transferFrom(msg.sender, pair, amountA);
        IERC20(tokenB).transferFrom(msg.sender, pair, amountB);
        liquidity = SilverbackV2Pair(pair).mint(to);
    }

    function _addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin
    ) internal view returns (uint amountA, uint amountB) {
        address pair = ISilverbackV2Factory(factory).getPair(tokenA, tokenB);
        if (pair == address(0)) {
            return (amountADesired, amountBDesired); // first liquidity
        }
        (uint112 reserveA, uint112 reserveB, ) = SilverbackV2Pair(pair).token0() == tokenA
            ? SilverbackV2Pair(pair).getReserves()
            : ( (uint112(SilverbackV2Pair(pair).getReserves().reserve1)), (uint112(SilverbackV2Pair(pair).getReserves().reserve0)), uint32(0) );
        uint amountBOptimal = SilverbackV2Library.quote(amountADesired, reserveA, reserveB);
        if (amountBOptimal <= amountBDesired) {
            require(amountBOptimal >= amountBMin, "INSUFFICIENT_B");
            (amountA, amountB) = (amountADesired, amountBOptimal);
        } else {
            uint amountAOptimal = SilverbackV2Library.quote(amountBDesired, reserveB, reserveA);
            require(amountAOptimal >= amountAMin, "INSUFFICIENT_A");
            (amountA, amountB) = (amountAOptimal, amountBDesired);
        }
    }

    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external returns (uint amountA, uint amountB) {
        address pair = ISilverbackV2Factory(factory).getPair(tokenA, tokenB);
        IERC20(pair).transferFrom(msg.sender, pair, liquidity);
        (uint amount0, uint amount1) = SilverbackV2Pair(pair).burn(to);
        (address token0,) = SilverbackV2Library.sortTokens(tokenA, tokenB);
        (amountA, amountB) = tokenA == token0 ? (amount0, amount1) : (amount1, amount0);
        require(amountA >= amountAMin, "SLIP_A");
        require(amountB >= amountBMin, "SLIP_B");
    }

    // --------- swaps ---------
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint amountOut) {
        require(path.length == 2, "SIMPLE_PATH_ONLY");
        address tokenIn = path[0];
        address tokenOut = path[1];
        address pair = ISilverbackV2Factory(factory).getPair(tokenIn, tokenOut);
        require(pair != address(0), "PAIR_MISSING");
        IERC20(tokenIn).transferFrom(msg.sender, pair, amountIn);
        (address token0,) = SilverbackV2Library.sortTokens(tokenIn, tokenOut);
        (uint112 r0, uint112 r1,) = SilverbackV2Pair(pair).getReserves();
        (uint reserveIn, uint reserveOut) = tokenIn == token0 ? (r0, r1) : (r1, r0);
        amountOut = SilverbackV2Library.getAmountOut(amountIn, reserveIn, reserveOut);
        (uint amount0Out, uint amount1Out) = tokenIn == token0 ? (uint(0), amountOut) : (amountOut, uint(0));
        SilverbackV2Pair(pair).swap(amount0Out, amount1Out, to);
        require(amountOut >= amountOutMin, "SLIPPAGE");
    }
}
