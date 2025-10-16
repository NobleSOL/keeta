// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces.sol";
import "./SilverbackV2Library.sol";

interface IWETH9 is IWETH {}

contract SilverbackV2RouterV2 {
    address public immutable factory;
    address public immutable WETH;

    modifier ensure(uint deadline) {
        require(deadline >= block.timestamp, "EXPIRED");
        _;
    }

    constructor(address _factory, address _WETH) {
        factory = _factory;
        WETH = _WETH;
    }

    receive() external payable {
        require(msg.sender == WETH, "ETH_ONLY_WETH");
    }

    // **** ADD LIQUIDITY ****
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external ensure(deadline) returns (uint amountA, uint amountB, uint liquidity) {
        if (ISilverbackV2Factory(factory).getPair(tokenA, tokenB) == address(0)) {
            ISilverbackV2Factory(factory).createPair(tokenA, tokenB);
        }
        (uint reserveA, uint reserveB) = SilverbackV2Library.getReserves(factory, tokenA, tokenB);
        if (reserveA == 0 && reserveB == 0) {
            (amountA, amountB) = (amountADesired, amountBDesired);
        } else {
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
        address pair = ISilverbackV2Factory(factory).getPair(tokenA, tokenB);
        _safeTransferFrom(tokenA, msg.sender, pair, amountA);
        _safeTransferFrom(tokenB, msg.sender, pair, amountB);
        liquidity = ISilverbackV2Pair(pair).mint(to);
    }

    function addLiquidityETH(
        address token,
        uint amountTokenDesired,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    ) external payable ensure(deadline) returns (uint amountToken, uint amountETH, uint liquidity) {
        if (ISilverbackV2Factory(factory).getPair(token, WETH) == address(0)) {
            ISilverbackV2Factory(factory).createPair(token, WETH);
        }
        (uint reserveToken, uint reserveETH) = SilverbackV2Library.getReserves(factory, token, WETH);
        if (reserveToken == 0 && reserveETH == 0) {
            (amountToken, amountETH) = (amountTokenDesired, msg.value);
        } else {
            uint amountETHOptimal = SilverbackV2Library.quote(amountTokenDesired, reserveToken, reserveETH);
            if (amountETHOptimal <= msg.value) {
                require(amountETHOptimal >= amountETHMin, "INSUFFICIENT_ETH");
                (amountToken, amountETH) = (amountTokenDesired, amountETHOptimal);
            } else {
                uint amountTokenOptimal = SilverbackV2Library.quote(msg.value, reserveETH, reserveToken);
                require(amountTokenOptimal >= amountTokenMin, "INSUFFICIENT_TOKEN");
                (amountToken, amountETH) = (amountTokenOptimal, msg.value);
            }
        }
        address pair = ISilverbackV2Factory(factory).getPair(token, WETH);
        _safeTransferFrom(token, msg.sender, pair, amountToken);
        IWETH9(WETH).deposit{value: amountETH}();
        _safeTransfer(WETH, pair, amountETH);
        liquidity = ISilverbackV2Pair(pair).mint(to);
        if (msg.value > amountETH) payable(msg.sender).transfer(msg.value - amountETH);
    }

    // **** REMOVE LIQUIDITY ****
    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external ensure(deadline) returns (uint amountA, uint amountB) {
        address pair = ISilverbackV2Factory(factory).getPair(tokenA, tokenB);
        _safeTransferFrom(pair, msg.sender, pair, liquidity);
        (uint amount0, uint amount1) = ISilverbackV2Pair(pair).burn(to);
        (address token0,) = SilverbackV2Library.sortTokens(tokenA, tokenB);
        (amountA, amountB) = tokenA == token0 ? (amount0, amount1) : (amount1, amount0);
        require(amountA >= amountAMin, "INSUFFICIENT_A");
        require(amountB >= amountBMin, "INSUFFICIENT_B");
    }

    function removeLiquidityETH(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    ) external ensure(deadline) returns (uint amountToken, uint amountETH) {
        address pair = ISilverbackV2Factory(factory).getPair(token, WETH);
        _safeTransferFrom(pair, msg.sender, pair, liquidity);
        (uint amount0, uint amount1) = ISilverbackV2Pair(pair).burn(address(this));
        (address token0,) = SilverbackV2Library.sortTokens(token, WETH);
        (amountToken, amountETH) = token == token0 ? (amount0, amount1) : (amount1, amount0);
        require(amountToken >= amountTokenMin, "INSUFFICIENT_TOKEN");
        require(amountETH >= amountETHMin, "INSUFFICIENT_ETH");
        _safeTransfer(token, to, amountToken);
        IWETH9(WETH).withdraw(amountETH);
        payable(to).transfer(amountETH);
    }

    // **** SWAPS ****
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external ensure(deadline) returns (uint[] memory amounts) {
        amounts = SilverbackV2Library.getAmountsOut(factory, amountIn, path);
        require(amounts[amounts.length - 1] >= amountOutMin, "INSUFFICIENT_OUTPUT");
        _safeTransferFrom(path[0], msg.sender, SilverbackV2Library.pairFor(factory, path[0], path[1]), amounts[0]);
        _swap(amounts, path, to);
    }

    function swapExactETHForTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external payable ensure(deadline) returns (uint[] memory amounts) {
        require(path[0] == WETH, "INVALID_PATH");
        amounts = SilverbackV2Library.getAmountsOut(factory, msg.value, path);
        require(amounts[amounts.length - 1] >= amountOutMin, "INSUFFICIENT_OUTPUT");
        IWETH9(WETH).deposit{value: amounts[0]}();
        _safeTransfer(WETH, SilverbackV2Library.pairFor(factory, path[0], path[1]), amounts[0]);
        _swap(amounts, path, to);
    }

    function swapExactTokensForETH(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external ensure(deadline) returns (uint[] memory amounts) {
        require(path[path.length - 1] == WETH, "INVALID_PATH");
        amounts = SilverbackV2Library.getAmountsOut(factory, amountIn, path);
        require(amounts[amounts.length - 1] >= amountOutMin, "INSUFFICIENT_OUTPUT");
        _safeTransferFrom(path[0], msg.sender, SilverbackV2Library.pairFor(factory, path[0], path[1]), amounts[0]);
        _swap(amounts, path, address(this));
        IWETH9(WETH).withdraw(amounts[amounts.length - 1]);
        payable(to).transfer(amounts[amounts.length - 1]);
    }

    // internal helpers
    function _swap(uint[] memory amounts, address[] memory path, address _to) internal {
        for (uint i; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            (address token0,) = SilverbackV2Library.sortTokens(input, output);
            uint amountOut = amounts[i + 1];
            (uint amount0Out, uint amount1Out) = input == token0 ? (uint(0), amountOut) : (amountOut, uint(0));
            address to = i < path.length - 2 ? SilverbackV2Library.pairFor(factory, output, path[i + 2]) : _to;
            ISilverbackV2Pair(SilverbackV2Library.pairFor(factory, input, output)).swap(amount0Out, amount1Out, to);
        }
    }

    function _safeTransfer(address token, address to, uint value) private {
        (bool s, bytes memory d) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, value));
        require(s && (d.length == 0 || abi.decode(d, (bool))), "TRANSFER");
    }

    function _safeTransferFrom(address token, address from, address to, uint value) private {
        (bool s, bytes memory d) = token.call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, value));
        require(s && (d.length == 0 || abi.decode(d, (bool))), "TRANSFER_FROM");
    }
}
